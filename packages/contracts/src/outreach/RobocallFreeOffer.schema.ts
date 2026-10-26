import { z } from 'zod'
import type { RecommendedListVariant } from '../recommendedLists/RecommendedLists.schema'

// The free election-eve robocall offer (Nov 3, 2026 general): one covered
// robocall to every landline voter in a random half of the campaign's
// precincts. The offer is a recommended list of its own, so every surface
// finds it by this variant.
export const ROBOCALL_FREE_OFFER_VARIANT =
  'freeOfferElectionEveRobocall' satisfies RecommendedListVariant

// Election eve. The schedule step prefills it; the candidate can change it.
export const ROBOCALL_FREE_OFFER_SEND_DATE = '2026-11-02'

// `GET /v1/campaigns/mine/robocall-offer`. `count` is the landline voters on
// the offer list and `coveredCalls` how many calls the offer pays for; both
// are null whenever the offer does not apply.
export const RobocallFreeOfferResponseSchema = z.object({
  eligible: z.boolean(),
  variant: z.literal(ROBOCALL_FREE_OFFER_VARIANT),
  count: z.number().int().nonnegative().nullable(),
  coveredCalls: z.number().int().nonnegative().nullable(),
})
export type RobocallFreeOfferResponse = z.infer<
  typeof RobocallFreeOfferResponseSchema
>
