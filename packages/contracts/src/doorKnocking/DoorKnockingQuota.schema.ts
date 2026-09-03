import { z } from 'zod'

// The one daily allowance a create has to clear: how many door-knocking
// campaigns this organization may cut in a rolling 24 hours. A 500-stop
// budget used to be reported alongside it and has been removed — one limit,
// checked in one place, refused with one message.
//
// The limit rides along with the remainder rather than being a constant the
// client keeps its own copy of, because it is genuinely per organization: an
// admin can raise a single org, so a hardcoded 5 would be wrong for exactly
// the orgs that were raised.
//
// Advisory. `assertCampaignQuota` inside the create transaction is the
// authority, and a teammate's turf can spend the allowance between this read
// and the press — this exists so the flow can refuse to OPEN on a spent day
// rather than take a candidate through five steps and 429 at the end.
export const DoorKnockingQuotaResponseSchema = z.object({
  campaignsRemaining: z.number().int().nonnegative(),
  campaignLimit: z.number().int().positive(),
})

export type DoorKnockingQuotaResponse = z.infer<
  typeof DoorKnockingQuotaResponseSchema
>
