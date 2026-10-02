/**
 * Cache of baseline outputs, keyed by (agent, baseline ref, case).
 *
 * Without this, every comment on every PR pays to re-run the incumbent against
 * inputs it has already answered. The baseline only changes when main changes, so
 * the ref is part of the key and a new main invalidates the cache on its own.
 *
 * Lives in the artifacts bucket under a reserved prefix rather than in a database,
 * so the harness keeps its "S3 and nothing else" dependency footprint.
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { artifactBucket, REGION } from './adapters/capBackground.js'
import type { RunOutcome } from './types.js'

const PREFIX = '_universal_judge/baselines'

export type CachedBaseline = {
  output: unknown
  costUsd?: number
  durationSeconds?: number
  cachedAt: string
  ref: string
}

const key = (agent: string, ref: string, caseId: string) => {
  const safeRef = ref.replace(/[^a-zA-Z0-9._-]+/g, '-')
  return `${PREFIX}/${agent}/${safeRef}/${caseId}.json`
}

export const readBaseline = async (args: {
  agent: string
  ref: string
  caseId: string
  env: string
  s3?: S3Client
}): Promise<CachedBaseline | undefined> => {
  const s3 = args.s3 ?? new S3Client({ region: REGION })
  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: artifactBucket(args.env),
        Key: key(args.agent, args.ref, args.caseId),
      }),
    )
    return JSON.parse(await res.Body!.transformToString()) as CachedBaseline
  } catch {
    return undefined
  }
}

export const writeBaseline = async (args: {
  agent: string
  ref: string
  caseId: string
  env: string
  outcome: RunOutcome
  s3?: S3Client
}) => {
  if (args.outcome.status !== 'ok' || args.outcome.output === undefined) return
  const s3 = args.s3 ?? new S3Client({ region: REGION })
  const payload: CachedBaseline = {
    output: args.outcome.output,
    costUsd: args.outcome.costUsd,
    durationSeconds: args.outcome.durationSeconds,
    cachedAt: new Date().toISOString(),
    ref: args.ref,
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: artifactBucket(args.env),
      Key: key(args.agent, args.ref, args.caseId),
      Body: JSON.stringify(payload, null, 2),
      ContentType: 'application/json',
    }),
  )
}

export const toOutcome = (
  cached: CachedBaseline,
  caseId: string,
): RunOutcome => ({
  caseId,
  variant: 'baseline',
  status: 'ok',
  output: cached.output,
  costUsd: cached.costUsd,
  durationSeconds: cached.durationSeconds,
})
