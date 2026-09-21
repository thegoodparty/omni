import { z } from 'zod'

// Candidate-facing per-campaign text results (the details sheet's
// Statistics card): counts only — reply content never leaves the CRM.
// Percentages are presentation and stay client-side.
export const SmsOutreachResultsSchema = z.object({
  // Recipients the campaign addressed: the per-recipient interaction rows
  // when they exist, else the billable/text count recorded at purchase.
  contacts: z.number(),
  responded: z.number(),
  optedOut: z.number(),
})
export type SmsOutreachResults = z.infer<typeof SmsOutreachResultsSchema>

// One inbound reply to a text send, for the read-only reply list the Serve
// results surface renders. Read-only is the whole shape: there is no
// favourite flag, no read state and no thread, because a thread needs
// per-person outbound SMS the Slack fulfilment path does not have (see
// docs/features/serve-sms.md, "Out of scope in v1").
//
// Reply content lives on `poll_individual_message`, the only place in the
// schema that stores inbound SMS text — the Win inbound sweep records
// timestamps on ContactInteractionText and never the body. The identity
// fields come from the People DB row the message's `personId` names; any of
// them can be null when that lookup finds nothing.
export const SmsOutreachReplySchema = z.object({
  id: z.string(),
  personId: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  phone: z.string().nullable(),
  content: z.string(),
  receivedAt: z.string(),
  isOptOut: z.boolean(),
})
export type SmsOutreachReply = z.infer<typeof SmsOutreachReplySchema>

// Default page of the reply list; `total` is every reply on the send, so the
// design's "Show all {n} responses" affordance can name a number it has not
// fetched.
export const SMS_OUTREACH_REPLIES_DEFAULT_LIMIT = 10
export const SMS_OUTREACH_REPLIES_MAX_LIMIT = 200

export const SmsOutreachRepliesSchema = z.object({
  total: z.number(),
  replies: z.array(SmsOutreachReplySchema),
})
export type SmsOutreachReplies = z.infer<typeof SmsOutreachRepliesSchema>
