import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { S3Client } from '@aws-sdk/client-s3'
import { z } from 'zod'
import { judgeAwsClientConfig } from '../awsCredentials'
import {
  RecordNotFoundError,
  createLocalRecordStore,
  createS3RecordStore,
  s3PortFromClient,
  type RecordStore,
} from '../records'
import {
  formatGuardBaselineTrailer,
  regressedCaseIds,
  type GuardBaseline,
} from './guardBaseline'
import { readGuardBaseline } from './guardBaselineCli'
import type { GuardLedgerPort } from './guardLedger'
import { localGuardLedgerPort, s3GuardLedgerPort } from './guardLedgerStore'
import {
  parseAgentOutcomeEntries,
  type AgentOutcomeEntry,
} from './guardVerdict'

// ENG-11593: runs in judge.yml's sweep job, right after "Judge both arms"
// writes report.md and before "Keep the report for the PR" uploads it —
// only for a guard sweep (guard_context present). The guard job itself can
// never do this work: it holds no AWS role at all (judge-guard.yml's own
// header), so it can read neither a WORSE agent's stored judgments (to find
// which cases moved) nor its main-vs-main baseline (guardBaselineCli.ts's
// `judge baseline`). This CLI does both, with the role this job already
// holds, and leaves the rendered trailer in the public report.md for
// guardVerdict.ts's resolveGuardVerdict — which holds no AWS role either —
// to read back out under GUARD_BASELINE_HEADING.
//
// Also the one place that turns report.md's headings back into
// `agentId:OUTCOME` pairs for the ledger line's `verdicts` field: the
// verdict map and the trailer both start from the same parse of the same
// report, so there is one reading of it rather than two that could disagree.

export interface AppendTrailerDeps {
  store: RecordStore
  ledgerPort: GuardLedgerPort
  sweepId: string
}

export interface AppendTrailerResult {
  verdicts: readonly AgentOutcomeEntry[]
  // `undefined` for a report with no WORSE agent, or when none of the WORSE
  // agents has a baseline — distinct from `report`, which is always
  // returned (unchanged in that case).
  baselineRunId: string | undefined
  report: string
}

export const appendBaselineTrailer = async (
  report: string,
  deps: AppendTrailerDeps,
): Promise<AppendTrailerResult> => {
  const verdicts = parseAgentOutcomeEntries(report)
  const worseAgents = verdicts.filter((e) => e.outcome === 'WORSE')
  if (worseAgents.length === 0)
    return { verdicts, baselineRunId: undefined, report }

  const agentTrailers: {
    agentId: string
    movedCaseIds: readonly string[]
    baseline: GuardBaseline | undefined
  }[] = []
  let baselineRunId: string | undefined

  for (const { agentId } of worseAgents) {
    let judgments
    try {
      judgments = (await deps.store.getRulings(deps.sweepId, agentId)).judgments
    } catch (err) {
      if (!(err instanceof RecordNotFoundError)) throw err
      agentTrailers.push({ agentId, movedCaseIds: [], baseline: undefined })
      continue
    }
    const movedCaseIds = regressedCaseIds(judgments)
    const baseline = await readGuardBaseline(deps.ledgerPort, agentId)
    if (baseline !== undefined && baselineRunId === undefined) {
      baselineRunId = baseline.runId
    }
    agentTrailers.push({ agentId, movedCaseIds, baseline })
  }

  const trailer = formatGuardBaselineTrailer(agentTrailers)
  return {
    verdicts,
    baselineRunId,
    report: `${report}\n\n${trailer}\n`,
  }
}

// `SWEEP_ID` is read from the job's own env (set once, job-level, as
// `judge-${run_id}-${run_attempt}`) rather than rebuilt from `github.run_id`
// here: a re-run (`run_attempt` > 1) would otherwise point this at records
// that do not exist, since a re-run never reads the first attempt's.
const EnvSchema = z.object({
  JUDGE_RECORDS_BUCKET: z.string().min(1).optional(),
  JUDGE_RECORDS_DIR: z.string().min(1).optional(),
  SWEEP_ID: z.string().min(1),
  REPORT_FILE: z.string().min(1),
  GITHUB_OUTPUT: z.string().min(1),
})

const writeOutput = (path: string, key: string, value: string): void => {
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`
  appendFileSync(path, `${key}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8')
}

export const main = async (): Promise<void> => {
  const env = EnvSchema.parse(process.env)

  if (!existsSync(env.REPORT_FILE)) {
    // A cancelled run, or one that died before judging ran, leaves no
    // report to annotate. The ledger-write step's own `if: always()` still
    // runs after this one; it just gets an empty verdict map.
    writeOutput(env.GITHUB_OUTPUT, 'verdicts', '')
    writeOutput(env.GITHUB_OUTPUT, 'baseline_run_id', '')
    console.log('::notice::no report.md to append a baseline trailer to')
    return
  }

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

  const result = await appendBaselineTrailer(
    readFileSync(env.REPORT_FILE, 'utf8'),
    {
      store,
      ledgerPort,
      sweepId: env.SWEEP_ID,
    },
  )

  writeOutput(
    env.GITHUB_OUTPUT,
    'verdicts',
    result.verdicts.map((e) => `${e.agentId}:${e.outcome}`).join(','),
  )
  writeOutput(env.GITHUB_OUTPUT, 'baseline_run_id', result.baselineRunId ?? '')
  writeFileSync(env.REPORT_FILE, result.report, 'utf8')

  const worseAgents = result.verdicts.filter((e) => e.outcome === 'WORSE')
  if (worseAgents.length > 0) {
    console.log(
      `::notice::guard baseline trailer appended for ` +
        `${worseAgents.map((a) => a.agentId).join(',')}`,
    )
  }
}

// Never fails the job: judge.yml's own workflow step runs this with
// `continue-on-error: true`, since a crash here must cost only the trailer
// and the verdict map, never the ledger-write step after it or the report
// the PR already shows.
if (require.main === module) {
  void main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
