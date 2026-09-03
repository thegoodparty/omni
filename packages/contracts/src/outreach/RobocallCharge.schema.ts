import { z } from 'zod'
import { RobocallAuthorizeResponseSchema } from './RobocallHold.schema'

// POST /v1/outreach/robocall/:outreachId/charge — the CONTINGENCY upfront-charge
// pay path (isolated on the robocall-estimate-billing branch, never main). It
// charges the server-re-derived ESTIMATE immediately and in full — no
// manual-capture hold, no capture-actual settlement. The billable count and
// amount are never accepted from the client: the server re-derives them from the
// stored draft before charging.
export const RobocallChargeRequestSchema = z.object({
  // The vaulted card the charge runs against. Confirmed to belong to the paying
  // user's Stripe customer server-side before any money moves.
  paymentMethodId: z.string().min(1),
})
export type RobocallChargeRequest = z.infer<typeof RobocallChargeRequestSchema>

// The outcome of a charge call:
// - paid: the estimate was charged (or was already charged); the draft is `paid`.
// - charge_failed: the card was declined; the candidate must supply a new card.
// - noop: a concurrent charge won or the draft already moved past
//   pending_payment; no charge was placed this call.
export const RobocallChargeStatusSchema = z.enum([
  'paid',
  'charge_failed',
  'noop',
])
export type RobocallChargeStatus = z.infer<typeof RobocallChargeStatusSchema>

export const RobocallChargeResponseSchema = z.object({
  status: RobocallChargeStatusSchema,
  // The satellite's current settle state after this call, so the client can
  // render the exact lifecycle position without a second read.
  settleState: z.string(),
  // The frozen estimate that was charged, in cents, present only when paid.
  chargedAmountInCents: z.number().int().min(0).nullable(),
})
export type RobocallChargeResponse = z.infer<
  typeof RobocallChargeResponseSchema
>

// The pay endpoint (POST /v1/outreach/robocall/:outreachId/authorize) returns
// ONE of the two billing models' shapes depending on the server flag
// ROBOCALL_ESTIMATE_BILLING_ENABLED: the hold response (default) or the
// upfront-charge response (CONTINGENCY). The two are unambiguous — a hold
// response carries authorizedAmountInCents and a charge response carries
// chargedAmountInCents — so a discriminating client reads whichever `status`
// tells it to. Both models leave the request identical (just paymentMethodId).
export const RobocallPayResponseSchema = z.union([
  RobocallAuthorizeResponseSchema,
  RobocallChargeResponseSchema,
])
export type RobocallPayResponse = z.infer<typeof RobocallPayResponseSchema>
