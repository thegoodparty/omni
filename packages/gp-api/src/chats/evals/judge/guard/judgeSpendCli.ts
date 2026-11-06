import { S3Client } from '@aws-sdk/client-s3'
import { z } from 'zod'
import { judgeAwsClientConfig } from '../awsCredentials'
import {
  monthKeyOf,
  recentMonthKeys,
  readLedgerMonths,
  type GuardLedgerLine,
  type GuardLedgerPort,
} from './guardLedger'
import { localGuardLedgerPort, s3GuardLedgerPort } from './guardLedgerStore'
import {
  SPEND_HISTORY_MONTHS,
  localScoutSpendPort,
  s3ScoutSpendPort,
  scoutSpendOverMonths,
  type ScoutSpendPort,
} from './scoutSpend'

// `judge spend`: ENG-11593's "Jeff wants eval spend reported on its own
// line per piece (scout, guard, climb); this story is the guard's half of
// that, plus a CLI to sum it up." No per-PR filter, unlike
// sumSpentCentsForPr — this totals every guard ledger line, across every PR,
// the same way the scout side totals every run.
export const guardSpendCents = (lines: readonly GuardLedgerLine[]): number =>
  lines.reduce(
    (cents, line) => cents + Math.round((line.spendUsd + line.pickerUsd) * 100),
    0,
  )

export interface SpendTotals {
  readonly scoutUsd: number
  readonly guardUsd: number
  readonly totalUsd: number
}

export const sumSpend = async (
  guardPort: GuardLedgerPort,
  scoutPort: ScoutSpendPort,
  months: readonly string[],
): Promise<SpendTotals> => {
  const [guardLines, scoutUsd] = await Promise.all([
    readLedgerMonths(guardPort, months),
    scoutSpendOverMonths(scoutPort, months),
  ])
  const guardUsd = guardSpendCents(guardLines) / 100
  return { scoutUsd, guardUsd, totalUsd: scoutUsd + guardUsd }
}

export const formatSpendReport = (
  monthToDate: SpendTotals,
  grandTotal: SpendTotals,
  historyMonths: number,
): string =>
  [
    'Universal Judge — spend',
    '',
    'Month to date:',
    `  scout:  $${monthToDate.scoutUsd.toFixed(2)}`,
    `  guard:  $${monthToDate.guardUsd.toFixed(2)}`,
    `  total:  $${monthToDate.totalUsd.toFixed(2)}`,
    '',
    `Trailing ${historyMonths} months (grand total — neither ledger` +
      ' supports an unbounded history listing today):',
    `  scout:  $${grandTotal.scoutUsd.toFixed(2)}`,
    `  guard:  $${grandTotal.guardUsd.toFixed(2)}`,
    `  total:  $${grandTotal.totalUsd.toFixed(2)}`,
  ].join('\n')

const EnvSchema = z.object({
  JUDGE_RECORDS_BUCKET: z.string().min(1).optional(),
  JUDGE_RECORDS_DIR: z.string().min(1).optional(),
  CASE_SCOUT_BUCKET: z.string().min(1).optional(),
  CASE_SCOUT_RECORDS_DIR: z.string().min(1).optional(),
})

export const HELP = `judge spend — sums case scout nightly spend and guard
ledger spend across both ledgers and prints a total.

Usage: judge spend

Reads JUDGE_RECORDS_BUCKET (or JUDGE_RECORDS_DIR for a local run) for the
guard ledger, and CASE_SCOUT_BUCKET (or CASE_SCOUT_RECORDS_DIR) for the case
scout's nightly runs. Either ledger is treated as empty, not an error, when
its env var is unset — a bucket this CLI's role cannot reach reports zero
rather than throwing, since the two are separate buckets under separate IAM
roles (see scoutSpend.ts). Prints month-to-date and a trailing
${SPEND_HISTORY_MONTHS}-month total for each, and a combined total.
`

export const main = async (
  now: () => Date = () => new Date(),
): Promise<void> => {
  const env = EnvSchema.parse(process.env)

  const guardPort =
    env.JUDGE_RECORDS_BUCKET !== undefined
      ? s3GuardLedgerPort(
          new S3Client(judgeAwsClientConfig()),
          env.JUDGE_RECORDS_BUCKET,
        )
      : localGuardLedgerPort(env.JUDGE_RECORDS_DIR ?? '.judge-records')

  const scoutPort =
    env.CASE_SCOUT_BUCKET !== undefined
      ? s3ScoutSpendPort(
          new S3Client(judgeAwsClientConfig()),
          env.CASE_SCOUT_BUCKET,
        )
      : localScoutSpendPort(env.CASE_SCOUT_RECORDS_DIR ?? '.case-scout-records')

  const thisMonth = [monthKeyOf(now().toISOString())]
  const historyMonths = recentMonthKeys(now(), SPEND_HISTORY_MONTHS)

  const [monthToDate, grandTotal] = await Promise.all([
    sumSpend(guardPort, scoutPort, thisMonth),
    sumSpend(guardPort, scoutPort, historyMonths),
  ])

  console.log(formatSpendReport(monthToDate, grandTotal, SPEND_HISTORY_MONTHS))
}

if (require.main === module) {
  if (process.argv.includes('--help')) {
    console.log(HELP)
  } else {
    void main().catch((err: Error) => {
      console.error(err.message)
      process.exitCode = 1
    })
  }
}
