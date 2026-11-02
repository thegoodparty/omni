import { z } from 'zod'
import { SocialToneSchema } from './OutreachSocial.schema'
import { BROADCAST_OUTREACH_PURPOSE_VALUES } from './OutreachPurpose.schema'
import { OutreachEventDetailsSchema } from './OutreachEvent.schema'

// SMS is the canonical vocabulary every other outreach channel now shares,
// less the purpose that asks a question — see OutreachPurpose.schema.ts.
export const SMS_PURPOSE_VALUES = BROADCAST_OUTREACH_PURPOSE_VALUES
export const SmsPurposeSchema = z.enum(SMS_PURPOSE_VALUES)
export type SmsPurpose = z.infer<typeof SmsPurposeSchema>

// The composed message (intro + body + footer) cap; the body cap leaves
// headroom for the system regions.
// Raised from the prototype's 480 when Candidate Success delivered the
// message templates (2026-09-08, the "intro texts" structures): the
// recommended three-bullet intro runs 500-800 characters composed. Raised
// to 2000 (ENG-11355) to match Peerly's own MMS and the backend script cap.
export const SMS_COMPOSED_MAX_LENGTH = 2000
export const SMS_BODY_MAX_LENGTH = 360

export const SmsDraftRequestSchema = z.object({
  purpose: SmsPurposeSchema,
  tone: SocialToneSchema,
  currentDraft: z.string().min(1).max(SMS_COMPOSED_MAX_LENGTH).optional(),
  // An event invite's date, time and place, written into a fresh draft.
  event: OutreachEventDetailsSchema.optional(),
})
export type SmsDraftRequest = z.infer<typeof SmsDraftRequestSchema>

export const SmsDraftResponseSchema = z.object({
  draft: z.string().min(1).max(SMS_COMPOSED_MAX_LENGTH),
})
export type SmsDraftResponse = z.infer<typeof SmsDraftResponseSchema>
