import { S3Client } from '@aws-sdk/client-s3'
import { z } from 'zod'
import { judgeAwsClientConfig } from '../awsCredentials'
import {
  GuardLedgerLineSchema,
  GuardLedgerVerdictSchema,
  appendLedgerLine,
  type GuardLedgerLine,
} from './guardLedger'
import { localGuardLedgerPort, s3GuardLedgerPort } from './guardLedgerStore'

// Invoked from judge.yml's `sweep` job — the one job in the judge trigger
// chain that holds the judge-sweep AWS role — `if: always()`, so it runs for
// a completed, a cancelled and a failed run alike (Acceptance Criteria:
// every guard sweep appends exactly one line). judge-guard.yml itself never
// runs this: it has no AWS role at all (that file's own `permissions:`
// header), which is the entire reason this CLI lives on the other side of
// the dispatch.
export const EnvSchema = z.object({
  JUDGE_RECORDS_BUCKET: z.string().min(1).optional(),
  JUDGE_RECORDS_DIR: z.string().min(1).optional(),
  GUARD_PR_NUMBER: z.coerce.number().int().positive(),
  GUARD_HEAD_SHA: z.string().min(1),
  GUARD_RUN_ID: z.string().min(1),
  // Comma-separated agent ids. AGENTS is the final set the sweep actually
  // ran (floor plus whatever the picker added, after the spend cap); FLOOR
  // and ADDED are its two halves, carried separately so a later reader can
  // tell "path-matched" from "picker-added" apart.
  GUARD_AGENTS: z.string().default(''),
  GUARD_FLOOR: z.string().default(''),
  GUARD_ADDED: z.string().default(''),
  // `agentId:VERDICT,agentId:VERDICT`. Empty for a cancelled or failed run
  // that never reached a verdict.
  GUARD_VERDICTS: z.string().default(''),
  GUARD_PICKER_STATUS: z.enum(['ok', 'failed', 'capped']),
  GUARD_JOB_STATUS: z.enum(['success', 'cancelled', 'failure']),
  // The sweep's own actual-spend output, when the judging step ran and
  // measured it. Absent (not just empty) when judging never ran at all.
  GUARD_ACTUAL_USD: z.string().optional(),
  GUARD_PICKER_USD: z.coerce.number().nonnegative().default(0),
  GUARD_ESTIMATE_USD: z.coerce.number().nonnegative(),
  GUARD_BASELINE_RUN_ID: z.string().optional(),
})

const splitAgents = (value: string): string[] =>
  value
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a !== '')

const parseVerdicts = (value: string): GuardLedgerLine['verdicts'] =>
  Object.fromEntries(
    splitAgents(value).map((pair) => {
      const [agentId, verdict] = pair.split(':')
      return [
        agentId ?? pair,
        GuardLedgerVerdictSchema.parse(verdict ?? "CAN'T SAY"),
      ]
    }),
  )

const jobStatusToLedgerStatus = (
  status: z.infer<typeof EnvSchema>['GUARD_JOB_STATUS'],
): GuardLedgerLine['status'] =>
  status === 'success'
    ? 'completed'
    : status === 'cancelled'
      ? 'cancelled'
      : 'failed'

export const buildGuardLedgerLine = (
  env: z.infer<typeof EnvSchema>,
  now: () => Date,
): GuardLedgerLine => {
  const actualUsd =
    env.GUARD_ACTUAL_USD !== undefined && env.GUARD_ACTUAL_USD !== ''
      ? Number(env.GUARD_ACTUAL_USD)
      : undefined
  const measured = actualUsd !== undefined && Number.isFinite(actualUsd)

  return GuardLedgerLineSchema.parse({
    pr: env.GUARD_PR_NUMBER,
    headSha: env.GUARD_HEAD_SHA,
    agents: splitAgents(env.GUARD_AGENTS),
    floor: splitAgents(env.GUARD_FLOOR),
    added: splitAgents(env.GUARD_ADDED),
    verdicts: parseVerdicts(env.GUARD_VERDICTS),
    // A cancelled or failed run with no measured spend records its
    // pre-sweep estimate — the conservative, documented choice — rather
    // than zero, which would understate a run that really did spend.
    spendUsd: measured ? actualUsd : env.GUARD_ESTIMATE_USD,
    pickerUsd: env.GUARD_PICKER_USD,
    status: jobStatusToLedgerStatus(env.GUARD_JOB_STATUS),
    spendSource: measured ? 'report' : 'estimate',
    baselineRunId: env.GUARD_BASELINE_RUN_ID ?? null,
    picker: env.GUARD_PICKER_STATUS,
    ruling: null,
    runId: env.GUARD_RUN_ID,
    recordedAt: now().toISOString(),
  })
}

export const main = async (): Promise<void> => {
  const env = EnvSchema.parse(process.env)
  const port =
    env.JUDGE_RECORDS_BUCKET !== undefined
      ? s3GuardLedgerPort(
          new S3Client(judgeAwsClientConfig()),
          env.JUDGE_RECORDS_BUCKET,
        )
      : localGuardLedgerPort(env.JUDGE_RECORDS_DIR ?? '.judge-records')

  const line = buildGuardLedgerLine(env, () => new Date())
  await appendLedgerLine(port, line)
  console.log(
    `appended guard ledger line for PR #${line.pr} (${line.status}, ` +
      `${line.spendSource})`,
  )
}

if (require.main === module) {
  void main().catch((err: Error) => {
    console.error(err.message)
    process.exitCode = 1
  })
}
