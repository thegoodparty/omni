import { createHash, randomUUID } from 'crypto'
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { JudgeReplaySchema, type JudgeReplay } from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'

export type { JudgeReplay }

export const AGENT_REPLAY_S3 = 'AGENT_REPLAY_S3'

// The broker's recordings live in the agent artifacts bucket, and only the
// dev broker records, so dev is the default.
const replayBucket = () =>
  process.env.AGENT_REPLAY_BUCKET ?? 'gp-agent-artifacts-dev'

const TRACKING_PARAMS = new Set(['fbclid', 'gclid'])
const SCHEME_CHARS = /^[A-Za-z][A-Za-z0-9+.-]*$/

const unquotePlus = (value: string): string => {
  const text = value.replace(/\+/g, ' ')
  const bytes: number[] = []
  let i = 0
  while (i < text.length) {
    const hex = text.slice(i + 1, i + 3)
    if (text[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16))
      i += 3
      continue
    }
    const codePoint = text.codePointAt(i) ?? 0
    bytes.push(...Buffer.from(String.fromCodePoint(codePoint), 'utf8'))
    i += codePoint > 0xffff ? 2 : 1
  }
  return Buffer.from(bytes).toString('utf8')
}

const quotePlus = (value: string): string =>
  Array.from(Buffer.from(value, 'utf8'))
    .map((byte) => {
      const char = String.fromCharCode(byte)
      if (/[A-Za-z0-9_.~-]/.test(char)) return char
      if (char === ' ') return '+'
      return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    })
    .join('')

// A port of `normalize_url` in gp-ai `broker/page_replay.py` (urlsplit,
// parse_qsl, urlencode and urlunsplit), so a URL hashes to the key the broker
// recorded it under. Drops the fragment and tracking parameters, lowercases
// the scheme and host, and sorts the query.
export const normalizeReplayUrl = (url: string): string => {
  let rest = url
  let scheme = ''
  const colon = rest.indexOf(':')
  if (colon > 0 && SCHEME_CHARS.test(rest.slice(0, colon))) {
    scheme = rest.slice(0, colon).toLowerCase()
    rest = rest.slice(colon + 1)
  }
  let netloc = ''
  if (rest.startsWith('//')) {
    const end = rest.slice(2).search(/[/?#]/)
    netloc = end === -1 ? rest.slice(2) : rest.slice(2, end + 2)
    rest = end === -1 ? '' : rest.slice(end + 2)
  }
  const hash = rest.indexOf('#')
  if (hash !== -1) rest = rest.slice(0, hash)
  const question = rest.indexOf('?')
  const path = question === -1 ? rest : rest.slice(0, question)
  const rawQuery = question === -1 ? '' : rest.slice(question + 1)

  const at = netloc.lastIndexOf('@')
  const host =
    at === -1
      ? netloc.toLowerCase()
      : `${netloc.slice(0, at + 1)}${netloc.slice(at + 1).toLowerCase()}`

  const pairs = rawQuery
    .split('&')
    .filter((pair) => pair !== '')
    .map((pair): [string, string] => {
      const eq = pair.indexOf('=')
      return eq === -1
        ? [unquotePlus(pair), '']
        : [unquotePlus(pair.slice(0, eq)), unquotePlus(pair.slice(eq + 1))]
    })
    .filter(([name]) => {
      const lower = name.toLowerCase()
      return !lower.startsWith('utm_') && !TRACKING_PARAMS.has(lower)
    })
    .sort(([a, av], [b, bv]) =>
      a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1,
    )
  const query = pairs
    .map(([name, value]) => `${quotePlus(name)}=${quotePlus(value)}`)
    .join('&')

  let out = path
  if (host) {
    if (out && !out.startsWith('/')) out = `/${out}`
    out = `//${host}${out}`
  }
  if (scheme) out = `${scheme}:${out}`
  if (query) out = `${out}?${query}`
  return out
}

export const replayUrlDigest = (url: string): string =>
  createHash('sha256').update(normalizeReplayUrl(url), 'utf8').digest('hex')

// Exactly the broker's strict `_FetchMeta` and `_HeadMeta`.
const FetchMetaSchema = z
  .object({
    status: z.number().int().min(100).max(599),
    content_type: z.string(),
    final_url: z.string(),
    byte_size: z.number().int().min(0),
  })
  .strict()

const HeadMetaSchema = z
  .object({
    status: z.number().int().min(100).max(599),
    final_url: z.string(),
  })
  .strict()

export type ReplayedFetch = {
  status: number
  contentType: string
  finalUrl: string
  body: Buffer
}

export type ReplayedHead = { status: number; finalUrl: string }

type BoundReplay = { replay: JudgeReplay; issuedAt: number }

// Serves the Universal Judge's recorded pages to a run bound to a replay
// ticket. Engines bind a run before its first step and release it when the
// run ends. Only `replay` mode is served: the recording arm is the Python
// agent behind the broker, so a run bound in `record` mode fetches live.
// Every failure here reads as a miss, and the caller fetches live.
@Injectable()
export class AgentPageReplayService {
  private readonly bound = new Map<string, BoundReplay>()

  constructor(
    private readonly logger: PinoLogger,
    @Optional()
    @Inject(AGENT_REPLAY_S3)
    private readonly s3: S3Client = new S3Client({
      region: process.env.AWS_REGION ?? 'us-west-2',
    }),
  ) {}

  // issuedAt is whole seconds, like the broker's ticket. A recording written
  // at or after it came from a base run that outlived its poll, so it is a
  // miss: serving it would make the replay depend on timing.
  bind(
    runId: string,
    replay: JudgeReplay,
    issuedAt = Math.floor(Date.now() / 1000),
  ): void {
    this.bound.set(runId, { replay: JudgeReplaySchema.parse(replay), issuedAt })
  }

  release(runId: string): void {
    this.bound.delete(runId)
  }

  forRun(runId: string): JudgeReplay | undefined {
    return this.bound.get(runId)?.replay
  }

  async lookupFetch(
    runId: string,
    url: string,
  ): Promise<ReplayedFetch | undefined> {
    const binding = this.replayBinding(runId)
    if (!binding) return undefined
    const base = `${binding.replay.key}/fetch/${replayUrlDigest(url)}`
    const meta = await this.readMeta(
      runId,
      binding,
      `${base}.json`,
      FetchMetaSchema,
    )
    const body = meta ? await this.readBody(runId, `${base}.body`) : undefined
    const hit = meta !== undefined && body?.length === meta.byte_size
    await this.mark(runId, binding, 'fetch', hit)
    if (!hit || !meta || !body) return undefined
    return {
      status: meta.status,
      contentType: meta.content_type,
      finalUrl: meta.final_url,
      body,
    }
  }

  async lookupHead(
    runId: string,
    url: string,
  ): Promise<ReplayedHead | undefined> {
    const binding = this.replayBinding(runId)
    if (!binding) return undefined
    const meta = await this.readMeta(
      runId,
      binding,
      `${binding.replay.key}/head/${replayUrlDigest(url)}.json`,
      HeadMetaSchema,
    )
    await this.mark(runId, binding, 'head', meta !== undefined)
    return meta && { status: meta.status, finalUrl: meta.final_url }
  }

  private replayBinding(runId: string): BoundReplay | undefined {
    const binding = this.bound.get(runId)
    return binding?.replay.mode === 'replay' ? binding : undefined
  }

  private async readMeta<T extends z.ZodType>(
    runId: string,
    binding: BoundReplay,
    key: string,
    schema: T,
  ): Promise<z.infer<T> | undefined> {
    try {
      const obj = await this.s3.send(
        new GetObjectCommand({ Bucket: replayBucket(), Key: key }),
      )
      const modified = obj.LastModified?.getTime() ?? Infinity
      if (modified / 1000 >= binding.issuedAt || !obj.Body) return undefined
      const parsed = schema.safeParse(
        JSON.parse(await obj.Body.transformToString()),
      )
      return parsed.success ? parsed.data : undefined
    } catch (err) {
      const name = err instanceof Error ? err.name : 'unknown'
      if (!['NoSuchKey', 'AccessDenied', 'NotFound'].includes(name)) {
        this.logger.warn({ runId, err: name }, 'page replay read failed')
      }
      return undefined
    }
  }

  private async readBody(
    runId: string,
    key: string,
  ): Promise<Buffer | undefined> {
    try {
      const obj = await this.s3.send(
        new GetObjectCommand({ Bucket: replayBucket(), Key: key }),
      )
      return obj.Body
        ? Buffer.from(await obj.Body.transformToByteArray())
        : undefined
    } catch (err) {
      const name = err instanceof Error ? err.name : 'unknown'
      this.logger.warn({ runId, err: name }, 'page replay body read failed')
      return undefined
    }
  }

  // The judge counts these markers per run to report how much of a replay
  // was served from the recording. A failed write only loses the count.
  private async mark(
    runId: string,
    binding: BoundReplay,
    kind: 'fetch' | 'head',
    hit: boolean,
  ): Promise<void> {
    const outcome = hit ? 'hit' : 'miss'
    const key = `${binding.replay.key}/outcomes/${runId}/${kind}-${outcome}-${randomUUID().replace(/-/g, '')}`
    try {
      await this.s3.send(
        new PutObjectCommand({ Bucket: replayBucket(), Key: key, Body: '' }),
      )
    } catch (err) {
      const name = err instanceof Error ? err.name : 'unknown'
      this.logger.warn({ runId, err: name }, 'page replay marker failed')
    }
  }
}
