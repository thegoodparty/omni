import { z } from 'zod'
import {
  RobocallPurposeSchema,
  ROBOCALL_SCRIPT_MAX_LENGTH,
} from './RobocallScript.schema'

// POST /v1/outreach/robocall — creates the robocall as a `pending_payment`
// draft BEFORE checkout (mirrors the p2p draft-first flow), storing everything
// the payment-webhook finalize needs. The billable count and amount are NOT
// accepted from the client: the server re-derives them from voterFileFilterId
// (landline dimension) and returns them so the pay step can show the estimate.
export const RobocallDraftCreateRequestSchema = z.object({
  // The saved voter list the send targets. The billable landline count is
  // derived from this server-side; a client count is never trusted.
  voterFileFilterId: z.number().int().positive(),
  // The recorded audio's S3 object key (from the presign step). Confirmed to
  // belong to this campaign server-side before the draft is written.
  audioKey: z.string().min(1),
  // The rented CallHub caller-ID number the candidate reads aloud.
  callbackNumber: z.string().min(1).max(32),
  // When the robocall should go out, ISO-8601.
  scheduledAt: z.string().datetime(),
  // The script the candidate read into the recording (display/record only).
  script: z.string().min(1).max(ROBOCALL_SCRIPT_MAX_LENGTH).optional(),
  purpose: RobocallPurposeSchema.optional(),
  name: z.string().min(1).max(120).optional(),
})
export type RobocallDraftCreateRequest = z.infer<
  typeof RobocallDraftCreateRequestSchema
>

export const RobocallDraftCreateResponseSchema = z.object({
  // The draft's Outreach id — rides in the checkout-session metadata as
  // `outreachId`, the way the p2p draft's does.
  outreachId: z.number().int().positive(),
  // The server-derived landline count and the estimate charged for it, so the
  // pay step renders the same numbers the checkout will bill.
  billableCount: z.number().int().min(0),
  amountInCents: z.number().int().min(0),
})
export type RobocallDraftCreateResponse = z.infer<
  typeof RobocallDraftCreateResponseSchema
>
