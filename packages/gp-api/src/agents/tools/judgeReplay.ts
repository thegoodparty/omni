import { createHash, randomUUID } from 'node:crypto'
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { JudgeReplaySchema } from '@goodparty_org/contracts'
import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'

// A Universal Judge run's page replay ticket, carried on the agentRun job.
// judgeRunId names the run in the judge's records, so the hit and miss
// markers land where the report counts them. A recording written at or after
// issuedAt (whole seconds) came from a base run that outlived its poll, and
// is a miss, as in the broker.
export const AgentRunReplaySchema = z.object({
  replay: JudgeReplaySchema,
  judgeRunId: z.string().min(1),
  issuedAt: z.number().int(),
})
export type AgentRunReplay = z.infer<typeof AgentRunReplaySchema>

// Only the dev broker records, so its bucket is the one replayed.
const REPLAY_BUCKET = 'gp-agent-artifacts-dev'

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

const errorName = (err: unknown): string =>
  err instanceof Error ? err.name : 'unknown'

// Serves the pages the broker recorded for the judge's base arm to an
// in-process candidate run, and leaves the broker's hit and miss markers.
// Only `replay` mode is served; nothing here records. Every failure reads as
// a miss, and the caller fetches live.
@Injectable()
export class AgentPageReplayService {
  // The judge's candidate arm replaces this with a client holding the
  // judge's own credentials (sweep.eval.test.ts).
  s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-west-2' })

  constructor(private readonly logger: PinoLogger) {}

  async lookupFetch(
    run: AgentRunReplay,
    url: string,
  ): Promise<ReplayedFetch | undefined> {
    if (run.replay.mode !== 'replay') return undefined
    const base = `${run.replay.key}/fetch/${replayUrlDigest(url)}`
    const meta = await this.readMeta(run, `${base}.json`, FetchMetaSchema)
    const body = meta ? await this.readBody(run, `${base}.body`) : undefined
    const hit = meta !== undefined && body?.length === meta.byte_size
    await this.mark(run, 'fetch', hit)
    if (!hit || !meta || !body) return undefined
    return {
      status: meta.status,
      contentType: meta.content_type,
      finalUrl: meta.final_url,
      body,
    }
  }

  async lookupHead(
    run: AgentRunReplay,
    url: string,
  ): Promise<ReplayedHead | undefined> {
    if (run.replay.mode !== 'replay') return undefined
    const meta = await this.readMeta(
      run,
      `${run.replay.key}/head/${replayUrlDigest(url)}.json`,
      HeadMetaSchema,
    )
    await this.mark(run, 'head', meta !== undefined)
    return meta && { status: meta.status, finalUrl: meta.final_url }
  }

  private async readMeta<T extends z.ZodType>(
    run: AgentRunReplay,
    key: string,
    schema: T,
  ): Promise<z.infer<T> | undefined> {
    try {
      const obj = await this.s3.send(
        new GetObjectCommand({ Bucket: REPLAY_BUCKET, Key: key }),
      )
      const modified = obj.LastModified?.getTime() ?? Infinity
      if (modified / 1000 >= run.issuedAt || !obj.Body) return undefined
      const parsed = schema.safeParse(
        JSON.parse(await obj.Body.transformToString()),
      )
      return parsed.success ? parsed.data : undefined
    } catch (err) {
      const name = errorName(err)
      if (!['NoSuchKey', 'AccessDenied', 'NotFound'].includes(name)) {
        this.logger.warn(
          { judgeRunId: run.judgeRunId, err: name },
          'page replay read failed',
        )
      }
      return undefined
    }
  }

  private async readBody(
    run: AgentRunReplay,
    key: string,
  ): Promise<Buffer | undefined> {
    try {
      const obj = await this.s3.send(
        new GetObjectCommand({ Bucket: REPLAY_BUCKET, Key: key }),
      )
      return obj.Body
        ? Buffer.from(await obj.Body.transformToByteArray())
        : undefined
    } catch (err) {
      this.logger.warn(
        { judgeRunId: run.judgeRunId, err: errorName(err) },
        'page replay body read failed',
      )
      return undefined
    }
  }

  // The judge's report counts these per run. A failed write only loses the
  // count.
  private async mark(
    run: AgentRunReplay,
    kind: 'fetch' | 'head',
    hit: boolean,
  ): Promise<void> {
    const outcome = hit ? 'hit' : 'miss'
    const key = `${run.replay.key}/outcomes/${run.judgeRunId}/${kind}-${outcome}-${randomUUID().replace(/-/g, '')}`
    try {
      await this.s3.send(
        new PutObjectCommand({ Bucket: REPLAY_BUCKET, Key: key, Body: '' }),
      )
    } catch (err) {
      this.logger.warn(
        { judgeRunId: run.judgeRunId, err: errorName(err) },
        'page replay marker failed',
      )
    }
  }
}
