import { z } from 'zod'

// POST /v1/outreach/robocall/:outreachId/authorize — places a manual-capture
// Stripe hold on the vaulted card for the server-re-derived estimate of a
// scheduled pending_payment robocall draft whose send is within the hold
// window. The billable count and amount are never accepted from the client:
// the server re-derives them from the stored draft before authorizing.
export const RobocallAuthorizeRequestSchema = z.object({
  // The vaulted card the hold is placed on. Confirmed to belong to the paying
  // user's Stripe customer server-side before any charge.
  paymentMethodId: z.string().min(1),
})
export type RobocallAuthorizeRequest = z.infer<
  typeof RobocallAuthorizeRequestSchema
>

// The outcome of an authorize call:
// - authorized: a hold was placed (or already stood); the draft is `authorized`.
// - deferred: the send is beyond the hold window; the daily sweep places it.
// - hold_failed: the card was declined; the candidate must supply a new card.
// - noop: a concurrent placement won or the draft already moved past
//   pending_payment; no hold was placed this call.
export const RobocallAuthorizeStatusSchema = z.enum([
  'authorized',
  'deferred',
  'hold_failed',
  'noop',
])
export type RobocallAuthorizeStatus = z.infer<
  typeof RobocallAuthorizeStatusSchema
>

export const RobocallAuthorizeResponseSchema = z.object({
  status: RobocallAuthorizeStatusSchema,
  // The satellite's current settle state after this call, so the client can
  // render the exact lifecycle position without a second read.
  settleState: z.string(),
  // The frozen estimate the hold was placed for, present only when authorized.
  authorizedAmountInCents: z.number().int().min(0).nullable(),
})
export type RobocallAuthorizeResponse = z.infer<
  typeof RobocallAuthorizeResponseSchema
>
