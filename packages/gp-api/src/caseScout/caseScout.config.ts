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
export const DEFAULT_FIRST_NIGHT_WINDOW_HOURS = 24

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

// Set, it replaces the merge-share ladder (util/cap.util.ts) for every night.
// Blank, non-numeric or out of range keeps the ladder.
export const nightlyCapOverride = (): number | undefined =>
  z.coerce
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .catch(undefined)
    .parse(process.env.CASE_SCOUT_NIGHTLY_CAP ?? '')

// Read only with no marker. Blank, non-numeric or out of range reads the
// default.
export const firstNightWindowHours = (): number =>
  z.coerce
    .number()
    .int()
    .min(1)
    .max(336)
    .catch(DEFAULT_FIRST_NIGHT_WINDOW_HOURS)
    .parse(process.env.CASE_SCOUT_FIRST_NIGHT_WINDOW_HOURS ?? '')

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

// Off, the night's handoff is held in the bucket for a person to read and
// nothing leaves. Anything but exactly "true" holds.
export const sendsToDelegate = (): boolean =>
  process.env.CASE_SCOUT_SEND_TO_DELEGATE === 'true'

export const delegateWebhookUrl = (): string =>
  requiredEnv('CASE_SCOUT_DELEGATE_WEBHOOK_URL')

export const delegateWebhookSecret = (): string =>
  requiredEnv('CASE_SCOUT_DELEGATE_WEBHOOK_SECRET')

export const handoffEnvironment = (): 'dev' | 'prod' =>
  process.env.OTEL_SERVICE_ENVIRONMENT === 'prod' ? 'prod' : 'dev'

// The chat agents the scout scores. Any other scope is skipped before a model
// call; covering the next agent is one entry here.
export const COVERED_SCOPES: ReadonlySet<string> = new Set<ChatScope>([
  ChatScope.chief_of_staff,
  ChatScope.campaign_assistant,
])

// Severity 2 or 3 makes a session a drafting candidate.
export const CANDIDATE_MIN_SEVERITY = 2
