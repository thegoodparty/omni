import { z } from 'zod'

// Onboarding's "Are you already on the ballot?" answer. Lives on
// campaign.ballotStatus (a column) rather than in details, because the details
// allowlist silently strips keys it does not name — which is exactly how this
// answer was lost between 2026-05-20 and the column landing.
export const BALLOT_STATUSES = [
  'on-ballot',
  'qualified-not-filed',
  'considering',
  'testing',
] as const

export const BallotStatusSchema = z.enum(BALLOT_STATUSES)

export type BallotStatus = z.infer<typeof BallotStatusSchema>

// The column is a plain String?, so Prisma hands back `string | null`. Narrow it
// at the read boundary and treat anything unrecognised as unanswered rather
// than letting it reach a Record lookup keyed on the union.
export const parseBallotStatus = (value: string | null): BallotStatus | null =>
  BallotStatusSchema.safeParse(value).data ?? null
