import { ChatScope } from '@/generated/prisma'
import { z } from 'zod'

// Read when a job runs, not at import, so a deploy's env change takes effect
// on the next run and a test can stub it.

export const DEFAULT_SESSION_CAP = 75
export const DEFAULT_SPEND_CAP_USD = 50

// A flat, deliberately high estimate per paid call (about 7 times the real
// price), not metered spend: the cap bounds a runaway, it does not bill.
export const ESTIMATED_COST_PER_CALL_USD = 0.75

// With no marker yet, a night reads one night's worth of chats. All history
// would load up to 50,000 messages and spend the session cap on the oldest.
export const FIRST_NIGHT_WINDOW_HOURS = 24

export const caseScoutEnabled = (): boolean =>
  process.env.CASE_SCOUT_ENABLED === 'true'

// A blank, non-numeric or non-positive value falls back to the default, so a
// typo can never switch the runaway guard off.
export const sessionCap = (): number =>
  z.coerce
    .number()
    .int()
    .positive()
    .catch(DEFAULT_SESSION_CAP)
    .parse(process.env.CASE_SCOUT_SESSION_CAP ?? '')

export const spendCapUsd = (): number =>
  z.coerce
    .number()
    .positive()
    .catch(DEFAULT_SPEND_CAP_USD)
    .parse(process.env.CASE_SCOUT_SPEND_CAP_USD ?? '')

// Dev chats are nearly all staff and test accounts, so only prod drops them.
// Anything but exactly "prod" reads more, never silently less.
export const filtersInternalAccounts = (): boolean =>
  process.env.OTEL_SERVICE_ENVIRONMENT === 'prod'

const requiredEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set; the case scout cannot run`)
  }
  return value
}

export const caseScoutBucketName = (): string =>
  requiredEnv('CASE_SCOUT_BUCKET')

export const publisherFunctionName = (): string =>
  requiredEnv('CASE_SCOUT_LAMBDA_FUNCTION_NAME')

export const judgeRecordsBucketName = (): string | undefined =>
  process.env.CASE_SCOUT_JUDGE_RECORDS_BUCKET || undefined

// The chat agents the scout scores. Any other scope is skipped before a model
// call; covering the next agent is one entry here.
export const COVERED_SCOPES: ReadonlySet<string> = new Set<ChatScope>([
  ChatScope.chief_of_staff,
  ChatScope.campaign_assistant,
])

// Severity 2 or 3 makes a session a drafting candidate.
export const CANDIDATE_MIN_SEVERITY = 2
