/**
 * Produce outputs from a CAP background agent, for one variant.
 *
 * The baseline side needs no publishing: `publish-experiments.yml` republishes
 * every experiment on push to main, so whatever sits in the dev index already is
 * main. Only the candidate gets published, as a throwaway clone of the PR's
 * manifest under a derived id, deleted again when the run finishes.
 *
 * Three things this deliberately does NOT do:
 *
 *  - It does not call publish_experiments.py. That script has no per-experiment
 *    filter and regenerates index.json wholesale from the working tree, so running
 *    it from a PR branch can silently drop experiments another branch added. This
 *    merges a single entry instead, and removes it afterwards.
 *  - It does not copy the source experiment's qa/ folder. The in-run QA gate is a
 *    separate system with its own purpose; an eval clone should not pay for it or
 *    perturb it.
 *  - It does not touch Postgres, so the harness runs from CI without VPN access to
 *    the experiment_run database.
 */

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { RunOutcome, VariantRole } from '../types.js'

export const REGION = 'us-west-2'
const ACCOUNT = '333022194791'

/** A published experiment id must match this or the dispatch Lambda rejects it. */
const ID_PATTERN = /^[a-z][a-z0-9_]*$/
const SLUG_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

const POLL_INTERVAL_MS = 15_000

/**
 * The platform's own stale-run sweep force-fails a Fargate task at 45 minutes, so
 * waiting past that tells us nothing new.
 */
export const DEFAULT_TIMEOUT_MS = 50 * 60 * 1000

export const metadataBucket = (env: string) =>
  `agent-experiment-metadata-${env}`
export const artifactBucket = (env: string) => `gp-agent-artifacts-${env}`
export const queueUrl = (env: string) =>
  `https://sqs.${REGION}.amazonaws.com/${ACCOUNT}/agent-dispatch-${env}.fifo`

export const cloneId = (experimentId: string, tag: string) => {
  const safe = tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  // An empty tag would leave every variant sharing one id, so two PRs would
  // overwrite each other's clone mid-run.
  if (!safe) {
    throw new Error(
      `variant tag "${tag}" leaves no usable characters, so the derived experiment id is not publishable`,
    )
  }
  const derived = `${experimentId}_uj_${safe}`
  if (!ID_PATTERN.test(derived)) {
    throw new Error(`derived experiment id is not publishable: ${derived}`)
  }
  return derived
}

/**
 * Inline meta-schema $defs refs so the published manifest is self-contained.
 *
 * The runtime fetches a manifest straight from S3 and has no $ref resolver, so a
 * manifest published with refs intact fails input validation at dispatch.
 */
export const inlineRefs = (
  node: unknown,
  defs: Record<string, unknown>,
): unknown => {
  if (Array.isArray(node)) return node.map((item) => inlineRefs(item, defs))
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>
    const ref = record.$ref
    if (typeof ref === 'string' && ref.includes('#/$defs/')) {
      const pointer = ref.split('#/$defs/')[1]
      let target: unknown = defs
      for (const part of pointer.split('/')) {
        target = (target as Record<string, unknown>)?.[part]
        if (target === undefined)
          throw new Error(`$ref points at unknown $defs entry: ${ref}`)
      }
      return inlineRefs(target, defs)
    }
    return Object.fromEntries(
      Object.entries(record).map(([k, v]) => [k, inlineRefs(v, defs)]),
    )
  }
  return node
}

type IndexEntry = {
  id: string
  version: number
  manifest_key: string
  instruction_key: string
  attachment_keys: string[]
  hash: string
}

type Index = { experiments: IndexEntry[]; [key: string]: unknown }

const walkFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walkFiles(full) : [full]
  })
}

const readIndex = async (s3: S3Client, bucket: string): Promise<Index> => {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: 'index.json' }),
    )
    return JSON.parse((await res.Body!.transformToString()) || '{}') as Index
  } catch (error) {
    if (isMissing(error)) return { experiments: [] }
    throw error
  }
}

const writeIndex = async (s3: S3Client, bucket: string, index: Index) =>
  s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: 'index.json',
      Body: `${JSON.stringify(index, null, 2)}\n`,
      ContentType: 'application/json',
    }),
  )

const isMissing = (error: unknown) => {
  const name = (error as { name?: string; Code?: string })?.name
  const code = (error as { Code?: string })?.Code
  return (
    name === 'NoSuchKey' ||
    name === 'NotFound' ||
    code === 'NoSuchKey' ||
    (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode === 404
  )
}

/**
 * Publish the working tree's version of an experiment under a clone id.
 *
 * Uploads manifest + instruction + attachments, then adds one entry to
 * index.json. The qa/ folder is intentionally skipped.
 */
export const publishClone = async (args: {
  experimentsDir: string
  experimentId: string
  tag: string
  env: string
  /**
   * Swap the manifest's model on the clone only.
   *
   * CAP bakes the model into the manifest and has no per-run override, so the only
   * way to A/B a model is to publish a second experiment that differs by one field.
   * That is the first trade-off the eval brief names, so it gets a first-class
   * argument rather than asking someone to hand-edit a manifest and remember to
   * put it back.
   */
  modelOverride?: string
  s3?: S3Client
}) => {
  const s3 = args.s3 ?? new S3Client({ region: REGION })
  const source = join(args.experimentsDir, args.experimentId)
  const manifestPath = join(source, 'manifest.json')
  if (!existsSync(manifestPath))
    throw new Error(`no manifest at ${manifestPath}`)

  const metaSchemaPath = join(
    args.experimentsDir,
    '_schema',
    'manifest.schema.json',
  )
  const defs = (JSON.parse(readFileSync(metaSchemaPath, 'utf8')).$defs ??
    {}) as Record<string, unknown>

  const targetId = cloneId(args.experimentId, args.tag)
  const manifest = inlineRefs(
    JSON.parse(readFileSync(manifestPath, 'utf8')),
    defs,
  ) as Record<string, unknown>
  delete manifest.$schema
  manifest.id = targetId
  if (args.modelOverride) manifest.model = args.modelOverride

  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`
  const instructionBody = readFileSync(join(source, 'instruction.md'))
  const bucket = metadataBucket(args.env)

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${targetId}/manifest.json`,
      Body: manifestBody,
      ContentType: 'application/json',
    }),
  )
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${targetId}/instruction.md`,
      Body: instructionBody,
      ContentType: 'text/markdown',
    }),
  )

  const digest = createHash('sha256')
    .update(manifestBody)
    .update(instructionBody)
  const attachmentKeys: string[] = []
  const attachmentsDir = join(source, 'attachments')
  for (const file of walkFiles(attachmentsDir).sort()) {
    const rel = relative(attachmentsDir, file).split('\\').join('/')
    const key = `${targetId}/attachments/${rel}`
    const body = readFileSync(file)
    await s3.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }),
    )
    digest.update(rel).update(body)
    attachmentKeys.push(key)
  }

  const entry: IndexEntry = {
    id: targetId,
    version: Number(manifest.version ?? 1),
    manifest_key: `${targetId}/manifest.json`,
    instruction_key: `${targetId}/instruction.md`,
    attachment_keys: attachmentKeys,
    hash: `sha256:${digest.digest('hex')}`,
  }

  await mergeIndexEntry(s3, bucket, entry)
  return targetId
}

/**
 * Add or replace one entry in index.json, leaving every other entry alone.
 *
 * Read-modify-write, so it races with a concurrent full publish. That is
 * survivable here: the clone is short-lived, the caller re-checks the entry before
 * dispatching, and a main-branch publish dropping the entry does the same cleanup
 * this code would have done anyway.
 */
const mergeIndexEntry = async (
  s3: S3Client,
  bucket: string,
  entry: IndexEntry,
) => {
  const index = await readIndex(s3, bucket)
  index.experiments = [
    ...(index.experiments ?? []).filter((e) => e.id !== entry.id),
    entry,
  ].sort((a, b) => a.id.localeCompare(b.id))
  await writeIndex(s3, bucket, index)
}

export const indexHas = async (
  experimentId: string,
  env: string,
  s3?: S3Client,
) => {
  const client = s3 ?? new S3Client({ region: REGION })
  const index = await readIndex(client, metadataBucket(env))
  return (index.experiments ?? []).some((e) => e.id === experimentId)
}

/** Drop the clone from the index first, then delete its objects. */
export const unpublishClone = async (
  experimentId: string,
  env: string,
  s3?: S3Client,
) => {
  const client = s3 ?? new S3Client({ region: REGION })
  const bucket = metadataBucket(env)

  const index = await readIndex(client, bucket)
  const remaining = (index.experiments ?? []).filter(
    (e) => e.id !== experimentId,
  )
  if (remaining.length !== (index.experiments ?? []).length) {
    index.experiments = remaining
    await writeIndex(client, bucket, index)
  }

  let token: string | undefined
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${experimentId}/`,
        ContinuationToken: token,
      }),
    )
    const objects = (page.Contents ?? []).map((o) => ({ Key: o.Key! }))
    if (objects.length) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects },
        }),
      )
    }
    token = page.NextContinuationToken
  } while (token)
}

export const dispatch = async (args: {
  experimentId: string
  organizationSlug: string
  params: Record<string, unknown>
  env: string
  sqs?: SQSClient
}) => {
  if (!SLUG_PATTERN.test(args.organizationSlug)) {
    throw new Error(
      `organization_slug is not dispatchable: ${args.organizationSlug}`,
    )
  }
  const sqs = args.sqs ?? new SQSClient({ region: REGION })
  const runId = randomUUID()
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl(args.env),
      MessageBody: JSON.stringify({
        experiment_type: args.experimentId,
        run_id: runId,
        organization_slug: args.organizationSlug,
        params: args.params,
      }),
      MessageGroupId: `agent-dispatch-${args.organizationSlug}`,
      MessageDeduplicationId: runId,
    }),
  )
  return runId
}

/**
 * Wait for one run to reach a terminal state, using S3 alone.
 *
 * Success is an artifact.json. A contract violation is rejected/<run_id>.json.
 * Every other failure mode (timeout, harness crash, unparseable output) leaves no
 * marker at all, so it is reported as a timeout once the window closes.
 */
export const pollRun = async (args: {
  experimentId: string
  runId: string
  caseId: string
  variant: VariantRole
  env: string
  dispatchedAt: number
  timeoutMs?: number
  s3?: S3Client
  sleep?: (ms: number) => Promise<void>
}): Promise<RunOutcome> => {
  const s3 = args.s3 ?? new S3Client({ region: REGION })
  const sleep =
    args.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const bucket = artifactBucket(args.env)
  const artifactKey = `${args.experimentId}/${args.runId}/artifact.json`
  const rejectedKey = `rejected/${args.runId}.json`
  const deadline = args.dispatchedAt + (args.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  while (Date.now() < deadline) {
    try {
      const res = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: artifactKey }),
      )
      const output = JSON.parse(await res.Body!.transformToString())
      const finished = res.LastModified?.getTime() ?? Date.now()
      return {
        caseId: args.caseId,
        variant: args.variant,
        status: 'ok',
        output,
        durationSeconds: Math.max(0, (finished - args.dispatchedAt) / 1000),
        costUsd: await costFromSessionLog(
          s3,
          bucket,
          args.experimentId,
          args.runId,
        ),
        runId: args.runId,
      }
    } catch (error) {
      if (!isMissing(error)) throw error
    }

    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: rejectedKey }))
      return {
        caseId: args.caseId,
        variant: args.variant,
        status: 'rejected',
        error: 'Artifact failed output_schema validation (contract violation).',
        runId: args.runId,
      }
    } catch (error) {
      if (!isMissing(error)) throw error
    }

    await sleep(POLL_INTERVAL_MS)
  }

  const minutes = Math.round((args.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 60000)
  return {
    caseId: args.caseId,
    variant: args.variant,
    status: 'timeout',
    error: `No artifact after ${minutes} minutes.`,
    runId: args.runId,
  }
}

/**
 * Best-effort per-run cost, priced from the session transcript's token usage.
 *
 * The transcript records usage per assistant message but no dollar figure, so this
 * sums tokens and prices them. The authoritative number is experiment_run.costUsd
 * in Postgres, which CI cannot reach; this is close enough to show a direction and
 * is labelled as an estimate wherever it surfaces. When the model is unknown or the
 * transcript is missing, the result is undefined and the report shows a dash rather
 * than a number nobody should trust.
 *
 * Cache reads dominate these runs, so pricing them at the flat input rate would
 * overstate cost by roughly an order of magnitude.
 */
type Price = {
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
}

const PRICES_PER_MTOK: Record<string, Price> = {
  sonnet: { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  opus: { input: 15, cacheWrite: 18.75, cacheRead: 1.5, output: 75 },
  haiku: { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
}

const priceFor = (model: string): Price | undefined =>
  Object.entries(PRICES_PER_MTOK).find(([family]) =>
    model.includes(family),
  )?.[1]

export const costFromTranscript = (body: string): number | undefined => {
  const totals = new Map<
    string,
    { in: number; cw: number; cr: number; out: number }
  >()

  for (const line of body.split('\n')) {
    if (!line.trim()) continue
    let record: {
      message?: { model?: string; usage?: Record<string, unknown> }
    }
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const usage = record.message?.usage
    const model = record.message?.model
    if (!usage || typeof model !== 'string') continue

    const num = (key: string) =>
      typeof usage[key] === 'number' ? (usage[key] as number) : 0
    const running = totals.get(model) ?? { in: 0, cw: 0, cr: 0, out: 0 }
    running.in += num('input_tokens')
    running.cw += num('cache_creation_input_tokens')
    running.cr += num('cache_read_input_tokens')
    running.out += num('output_tokens')
    totals.set(model, running)
  }

  let cost: number | undefined
  for (const [model, t] of totals) {
    const price = priceFor(model)
    if (!price) continue
    cost =
      (cost ?? 0) +
      (t.in * price.input +
        t.cw * price.cacheWrite +
        t.cr * price.cacheRead +
        t.out * price.output) /
        1_000_000
  }
  return cost
}

const costFromSessionLog = async (
  s3: S3Client,
  bucket: string,
  experimentId: string,
  runId: string,
) => {
  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: `${experimentId}/${runId}/logs/session.jsonl`,
      }),
    )
    return costFromTranscript(await res.Body!.transformToString())
  } catch {
    return undefined
  }
}
