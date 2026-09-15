import { z } from 'zod'

// Onboarding's "What do you most want help with?" answer — the candidate's
// primary reason for signing up, asked once just before the pledge. A column,
// not a details key, for the same reason as ballotStatus: the details allowlist
// silently strips keys it does not name.
export const SIGNUP_GOALS = [
  'voter-data',
  'voter-outreach',
  'campaign-strategy',
  'templates-resources',
  'exploring',
] as const

export const SignupGoalSchema = z.enum(SIGNUP_GOALS)

export type SignupGoal = z.infer<typeof SignupGoalSchema>

// The column is a plain String?, so Prisma hands back `string | null`. Narrow it
// at the read boundary and treat anything unrecognised as unanswered rather
// than letting it reach a Record lookup keyed on the union.
export const parseSignupGoal = (value: string | null): SignupGoal | null =>
  SignupGoalSchema.safeParse(value).data ?? null
