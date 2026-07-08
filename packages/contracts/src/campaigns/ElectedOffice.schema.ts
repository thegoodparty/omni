import { z } from 'zod'

// Wire shape of an elected office as emitted by gp-api's `electedOfficeToApi`
// serializer: dates are date-only ('YYYY-MM-DD') or ISO strings, never Date
// objects, because the SDK consumes the JSON response without re-parsing.
// `isActive` and `termLengthDays` are derived server-side from the term dates.
export const ElectedOfficeSchema = z.object({
  id: z.string(),
  organizationSlug: z.string(),
  electedDate: z.string().nullable(),
  swornInDate: z.string().nullable(),
  termStartDate: z.string().nullable(),
  termEndDate: z.string().nullable(),
  termLengthDays: z.number().nullable(),
  isActive: z.boolean(),
  party: z.string().nullable(),
  pledgedAt: z.string().nullable(),
  onboardingCompletedAt: z.string().nullable(),
  // True when the holder self-reported their office/term via the net-new serve
  // onboarding flow (vs a sales/BallotReady prefill).
  selfReported: z.boolean(),
  // Resume checkpoint: the furthest serve-onboarding step the holder reached.
  onboardingStep: z.string().nullable(),
  userId: z.number(),
  campaignId: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ElectedOffice = z.infer<typeof ElectedOfficeSchema>
