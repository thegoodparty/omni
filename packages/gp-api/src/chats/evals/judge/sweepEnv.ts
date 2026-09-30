import { z } from 'zod'
import { SPEND_ENV, spendsRealMoney } from './config'
import { ArmSchema, type Arm } from './record'
import {
  createLocalRecordStore,
  createS3RecordStore,
  s3PortFromClient,
  type RecordStore,
} from './records'
import { S3Client } from '@aws-sdk/client-s3'

// THE SWEEP IS CONFIGURED FROM THE ENVIRONMENT, NOT FROM ARGV, and that is
// forced rather than chosen. The arm capture has to run under vitest, because
// `useTestService()` registers beforeAll/beforeEach/afterAll to stand up the
// Postgres container and the authenticated app — hooks that only exist inside
// a vitest process. A test file has no argv of its own, so the environment is
// the only channel left.
//
// Everything is validated up front and a missing value is a sentence naming
// it, because the alternative is a sweep that spends money and then dies
// several frames deep on an undefined.

const NON_EMPTY = z.string().trim().min(1)

// Both halves of a sweep must agree on the id, since it is the directory the
// two arms meet in. Held to the record store's key alphabet here so the
// failure is "your sweep id is wrong" rather than a path error on the first
// write, after the first turn has already been paid for.
const SweepIdSchema = NON_EMPTY.regex(
  /^[A-Za-z0-9_-]+$/,
  // Phrased to read after the variable's name, since that is how the error
  // sentence is assembled.
  'names a directory in the record store, so it may contain only letters, ' +
    'digits, underscore and hyphen',
)

// Deduped, the same way `parseAgentSelector` dedupes the CLI's list. A
// repeated id would be swept twice and billed twice, and the second pass
// would overwrite the first's records at the same keys — so the sweep would
// pay double and report single.
const AgentIdsSchema = NON_EMPTY.transform((value) => [
  ...new Set(
    value
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== ''),
  ),
]).refine((ids) => ids.length > 0, {
  message: 'no agent ids in JUDGE_AGENTS',
})

// Affirmative, the same way the workflow's `live` switch is: only the exact
// string 'true' spends. Anything empty, absent or garbled reads as "do not
// spend", so a mangled value costs a sweep that did not happen rather than one
// nobody asked for.
const spends = (value: string | undefined): boolean =>
  spendsRealMoney({ [SPEND_ENV]: value })

const PR_NUMBER = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => Number.parseInt(value, 10))
  .refine((n) => n > 0)

// Shared by both entry points: the sweep id, the agents, and where the records
// live. The arm capture needs more (see ArmEnvSchema); the judging entry needs
// exactly this.
const SweepEnvSchema = z.object({
  JUDGE_SWEEP_ID: SweepIdSchema,
  JUDGE_AGENTS: AgentIdsSchema,
  JUDGE_RECORDS_DIR: NON_EMPTY.optional(),
  JUDGE_RECORDS_BUCKET: NON_EMPTY.optional(),
  JUDGE_PR_NUMBER: PR_NUMBER.optional(),
  // Read by BOTH entry points, not just the arms. The judging step spends
  // too — one panel call per judgeable pair, per seat — so a switch that
  // gated only the arms would make "exercise the pipeline for nothing" a
  // false claim, and it was one.
  JUDGE_SPEND: z.string().optional(),
})

const ArmEnvSchema = SweepEnvSchema.extend({
  JUDGE_ARM: ArmSchema,
  JUDGE_BASE_REF: NON_EMPTY,
  JUDGE_CANDIDATE_SHA: NON_EMPTY,
  // The HEAD of the checkout THIS process is running in, which is the only
  // authoritative answer to "which commit produced these records": the base
  // arm runs in a worktree whose commit nothing else in the environment knows.
  JUDGE_ARM_COMMIT: NON_EMPTY,
  JUDGE_CANDIDATE_REF: NON_EMPTY.optional(),
  // The Delta table version BOTH arms must read, so a verdict can never be
  // an artifact of the voter data moving between the two captures. It comes
  // from outside the arm processes for exactly that reason: an arm that read
  // the current version itself would read a different one.
  JUDGE_DATA_VERSION: NON_EMPTY.optional(),
})

export class SweepEnvError extends Error {}

// One sentence, naming what is missing or wrong. Zod's own report is a tree,
// and a tree in a workflow log is what makes someone re-run a job to read it
// again.
//
// "Not set" is decided from the environment rather than from the issue,
// because an absent variable and a malformed one need different sentences and
// zod reports both as an invalid type.
const asSentence = (
  issues: readonly z.core.$ZodIssue[],
  source: NodeJS.ProcessEnv,
): string =>
  issues
    .map((issue) => {
      const name = String(issue.path[0] ?? '(root)')
      const value = source[name]
      return value === undefined || value.trim() === ''
        ? `${name} is not set`
        : `${name} ${issue.message}`
    })
    .join(', and ')

export interface SweepEnv {
  sweepId: string
  agentIds: string[]
  prNumber?: number
  recordsDir?: string
  recordsBucket?: string
  // False unless JUDGE_SPEND is exactly 'true'. On an arm it means the runner
  // gets a canned script; on the judging entry it means a canned panel. Both
  // have to honour it or the pipeline is not exercisable for nothing.
  spends: boolean
}

type ParsedSweep = z.infer<typeof SweepEnvSchema>

const toSweepEnv = (data: ParsedSweep): SweepEnv => ({
  sweepId: data.JUDGE_SWEEP_ID,
  agentIds: data.JUDGE_AGENTS,
  spends: spends(data.JUDGE_SPEND),
  ...(data.JUDGE_PR_NUMBER !== undefined && {
    prNumber: data.JUDGE_PR_NUMBER,
  }),
  ...(data.JUDGE_RECORDS_DIR !== undefined && {
    recordsDir: data.JUDGE_RECORDS_DIR,
  }),
  ...(data.JUDGE_RECORDS_BUCKET !== undefined && {
    recordsBucket: data.JUDGE_RECORDS_BUCKET,
  }),
})

export interface ArmEnv extends SweepEnv {
  arm: Arm
  baseRef: string
  candidateSha: string
  armCommit: string
  candidateRef?: string
  dataVersion?: string
}

const requireStore = (env: SweepEnv, what: string): void => {
  if (env.recordsDir === undefined && env.recordsBucket === undefined) {
    throw new SweepEnvError(
      `${what} has nowhere to put records: set JUDGE_RECORDS_DIR to a ` +
        'local directory, or JUDGE_RECORDS_BUCKET to an S3 bucket',
    )
  }
  if (env.recordsDir !== undefined && env.recordsBucket !== undefined) {
    throw new SweepEnvError(
      `${what} was given both JUDGE_RECORDS_DIR and JUDGE_RECORDS_BUCKET, ` +
        'and there is no rule for which one wins; set exactly one',
    )
  }
}

export const parseSweepEnv = (
  source: NodeJS.ProcessEnv = process.env,
): SweepEnv => {
  const parsed = SweepEnvSchema.safeParse(source)
  if (!parsed.success) {
    throw new SweepEnvError(
      'the judging entry cannot run: ' +
        asSentence(parsed.error.issues, source),
    )
  }
  const env = toSweepEnv(parsed.data)
  requireStore(env, 'the judging entry')
  return env
}

export const parseArmEnv = (
  source: NodeJS.ProcessEnv = process.env,
): ArmEnv => {
  const parsed = ArmEnvSchema.safeParse(source)
  if (!parsed.success) {
    throw new SweepEnvError(
      'the sweep cannot capture an arm: ' +
        asSentence(parsed.error.issues, source),
    )
  }
  const data = parsed.data

  // The candidate arm's commit is known twice: once as the PR head the plan
  // priced and once as the HEAD of this checkout. They must agree, or the
  // records describe a commit nobody asked about — which is exactly what a
  // stale or wrongly-fetched checkout produces, and it is invisible in the
  // records themselves because both values look like commits.
  if (
    data.JUDGE_ARM === 'candidate' &&
    data.JUDGE_ARM_COMMIT !== data.JUDGE_CANDIDATE_SHA
  ) {
    throw new SweepEnvError(
      `the candidate arm is checked out at ${data.JUDGE_ARM_COMMIT} but the ` +
        `sweep was planned against ${data.JUDGE_CANDIDATE_SHA}; this ` +
        'checkout is not the commit under test',
    )
  }

  const env: ArmEnv = {
    ...toSweepEnv(data),
    arm: data.JUDGE_ARM,
    baseRef: data.JUDGE_BASE_REF,
    candidateSha: data.JUDGE_CANDIDATE_SHA,
    armCommit: data.JUDGE_ARM_COMMIT,
    ...(data.JUDGE_CANDIDATE_REF !== undefined && {
      candidateRef: data.JUDGE_CANDIDATE_REF,
    }),
    ...(data.JUDGE_DATA_VERSION !== undefined && {
      dataVersion: data.JUDGE_DATA_VERSION,
    }),
  }
  requireStore(env, `the ${env.arm} arm`)
  return env
}

// What a record's `variant.ref` says for this arm. The base arm is a branch
// name; the candidate arm's head ref is not in the plan's outputs, so it falls
// back to naming the commit rather than to the base ref, which would make the
// two arms indistinguishable in the one field meant to tell them apart.
export const variantFor = (env: ArmEnv): { ref: string; commit: string } => ({
  ref:
    env.arm === 'base'
      ? env.baseRef
      : (env.candidateRef ?? `candidate@${env.candidateSha.slice(0, 12)}`),
  commit: env.armCommit,
})

export const storeFromEnv = (env: SweepEnv): RecordStore => {
  if (env.recordsBucket !== undefined) {
    const bucket = env.recordsBucket
    return createS3RecordStore(
      s3PortFromClient(new S3Client({}), bucket),
      bucket,
    )
  }
  if (env.recordsDir === undefined) {
    throw new SweepEnvError('no record store configured')
  }
  return createLocalRecordStore(env.recordsDir)
}
