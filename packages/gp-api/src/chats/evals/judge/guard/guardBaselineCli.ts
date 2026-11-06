import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { S3Client } from '@aws-sdk/client-s3'
import { judgeAwsClientConfig } from '../awsCredentials'
import { requireAgent } from '../agents'
import { caseJudgingOf, loadCaseList } from '../cases'
import {
  RecordNotFoundError,
  createLocalRecordStore,
  createS3RecordStore,
  s3PortFromClient,
  type RecordStore,
} from '../records'
import {
  GuardBaselineSchema,
  baselineKey,
  buildGuardBaseline,
  isGuardBaselineRefusal,
} from './guardBaseline'
import {
  readLedgerObject,
  writeLedgerObject,
  type GuardLedgerPort,
} from './guardLedger'
import { localGuardLedgerPort, s3GuardLedgerPort } from './guardLedgerStore'

const execFileAsync = promisify(execFile)

// `judge-<runId>-<attempt>`, same construction as judge.yml's own SWEEP_ID —
// `<runId>` here is the GitHub Actions run id (judge-guard.yml names it in
// the dispatch note it posts), and `attempt` is almost always 1.
export const sweepIdFor = (runId: string, attempt = 1): string =>
  `judge-${runId}-${attempt}`

// A no-change sweep's two commits are never byte-identical SHAs — a wiring
// sweep's candidate is an empty commit on top of base, which always mints a
// new SHA — so "ran the same code" has to be a tree comparison, not an
// identity check. `git diff --quiet` exits 1 (not an error) when the trees
// differ, 0 when they match, and anything else is a real failure (an unknown
// ref, a corrupt repo) that must not be read as "different code".
export const gitDiffIsEmpty = async (
  baseCommit: string,
  candidateCommit: string,
): Promise<boolean> => {
  try {
    await execFileAsync('git', ['diff', '--quiet', baseCommit, candidateCommit])
    return true
  } catch (err) {
    if (isExecError(err) && err.code === 1) return false
    throw err
  }
}

interface ExecError {
  code?: number
}
const isExecError = (err: unknown): err is ExecError =>
  typeof err === 'object' && err !== null && 'code' in err

export interface GuardBaselineCliResult {
  written: string[]
  refused: { agentId: string; reason: string }[]
  skipped: { agentId: string; reason: string }[]
}

export interface RunGuardBaselineInput {
  runId: string
  attempt?: number
  // Defaults to every agent the candidate arm's manifest named — the whole
  // agent set the no-change sweep actually ran.
  agentIds?: string[]
  store: RecordStore
  ledgerPort: GuardLedgerPort
  codeIsIdentical?: (
    baseCommit: string,
    candidateCommit: string,
  ) => Promise<boolean>
  now?: () => Date
}

export const runGuardBaseline = async (
  input: RunGuardBaselineInput,
): Promise<GuardBaselineCliResult> => {
  const sweepId = sweepIdFor(input.runId, input.attempt ?? 1)
  const now = input.now ?? (() => new Date())
  const codeIsIdentical = input.codeIsIdentical ?? gitDiffIsEmpty

  const [baseManifest, candidateManifest] = await Promise.all([
    input.store.getManifest(sweepId, 'base'),
    input.store.getManifest(sweepId, 'candidate'),
  ])
  const codeIdentical = await codeIsIdentical(
    baseManifest.commit,
    candidateManifest.commit,
  )

  const agentIds =
    input.agentIds ?? candidateManifest.agents.map((a) => a.agentId)

  const result: GuardBaselineCliResult = {
    written: [],
    refused: [],
    skipped: [],
  }

  for (const agentId of agentIds) {
    let judgments
    try {
      judgments = (await input.store.getRulings(sweepId, agentId)).judgments
    } catch (err) {
      if (!(err instanceof RecordNotFoundError)) throw err
      result.skipped.push({ agentId, reason: err.message })
      continue
    }

    const judging = caseJudgingOf(loadCaseList(requireAgent(agentId)))
    const controlCaseIds = new Set(
      [...judging.entries()]
        .filter(([, j]) => !j.scored)
        .map(([caseId]) => caseId),
    )

    const built = buildGuardBaseline({
      runId: input.runId,
      agentId,
      date: now().toISOString(),
      codeIdentical,
      judgments,
      controlCaseIds,
    })

    if (isGuardBaselineRefusal(built)) {
      result.refused.push({ agentId, reason: built.reason })
      continue
    }

    await writeLedgerObject(
      input.ledgerPort,
      baselineKey(agentId),
      `${JSON.stringify(GuardBaselineSchema.parse(built), null, 2)}\n`,
    )
    result.written.push(agentId)
  }

  return result
}

export const readGuardBaseline = async (
  port: GuardLedgerPort,
  agentId: string,
) => {
  const text = await readLedgerObject(port, baselineKey(agentId))
  return text === undefined
    ? undefined
    : GuardBaselineSchema.parse(JSON.parse(text))
}

export interface ParsedBaselineArgs {
  runId: string
  attempt?: number
  agentIds?: string[]
}

// The last non-flag token is the runId, so this reads the same whether it is
// dispatched as `judge baseline <runId>` from cli.ts (argv: ['baseline',
// '<runId>']) or run standalone as `npx tsx guardBaselineCli.ts <runId>`.
export const parseBaselineArgs = (argv: string[]): ParsedBaselineArgs => {
  const positional = argv.filter((a) => !a.startsWith('--'))
  const runId = positional[positional.length - 1]
  if (runId === undefined) {
    throw new Error(
      'judge baseline requires a <runId> argument — the GitHub Actions ' +
        'run id of a finished no-change sweep',
    )
  }
  const attempt = argv
    .find((a) => a.startsWith('--attempt='))
    ?.slice('--attempt='.length)
  const agents = argv
    .find((a) => a.startsWith('--agents='))
    ?.slice('--agents='.length)
  return {
    runId,
    ...(attempt !== undefined && { attempt: Number(attempt) }),
    ...(agents !== undefined && {
      agentIds: agents.split(',').filter((a) => a !== ''),
    }),
  }
}

const EnvSchema = z.object({
  JUDGE_RECORDS_BUCKET: z.string().min(1).optional(),
  JUDGE_RECORDS_DIR: z.string().min(1).optional(),
})

export const main = async (): Promise<void> => {
  const env = EnvSchema.parse(process.env)
  const args = parseBaselineArgs(process.argv.slice(2))

  const store: RecordStore =
    env.JUDGE_RECORDS_BUCKET !== undefined
      ? createS3RecordStore(
          s3PortFromClient(
            new S3Client(judgeAwsClientConfig()),
            env.JUDGE_RECORDS_BUCKET,
          ),
          env.JUDGE_RECORDS_BUCKET,
        )
      : createLocalRecordStore(env.JUDGE_RECORDS_DIR ?? '.judge-records')

  const ledgerPort: GuardLedgerPort =
    env.JUDGE_RECORDS_BUCKET !== undefined
      ? s3GuardLedgerPort(
          new S3Client(judgeAwsClientConfig()),
          env.JUDGE_RECORDS_BUCKET,
        )
      : localGuardLedgerPort(env.JUDGE_RECORDS_DIR ?? '.judge-records')

  const result = await runGuardBaseline({ ...args, store, ledgerPort })

  for (const agentId of result.written) {
    console.log(`wrote baseline for ${agentId}`)
  }
  for (const { agentId, reason } of result.skipped) {
    console.log(`skipped ${agentId}: ${reason}`)
  }
  for (const { agentId, reason } of result.refused) {
    console.error(`refused ${agentId}: ${reason}`)
  }
  process.exitCode = result.refused.length > 0 && result.written.length === 0 ? 1 : 0
}

if (require.main === module) {
  void main().catch((err: Error) => {
    console.error(err.message)
    process.exitCode = 1
  })
}
