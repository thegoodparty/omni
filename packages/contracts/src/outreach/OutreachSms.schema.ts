import { z } from 'zod'
import { SocialToneSchema } from './OutreachSocial.schema'
import { OUTREACH_PURPOSE_VALUES } from './OutreachPurpose.schema'

// SMS is the canonical vocabulary every other outreach channel now shares —
// see OutreachPurpose.schema.ts.
export const SMS_PURPOSE_VALUES = OUTREACH_PURPOSE_VALUES
export const SmsPurposeSchema = z.enum(SMS_PURPOSE_VALUES)
export type SmsPurpose = z.infer<typeof SmsPurposeSchema>

// The UI cap is 480 chars for the composed message (intro + body +
// footer); the body cap leaves headroom for the system regions. Both sit
// far inside the backend's 2000-char script cap.
// Raised from the prototype's 480 when Candidate Success delivered the
// message templates (2026-09-08, the "intro texts" structures): the
// recommended three-bullet intro runs 500-800 characters composed. Peerly's
// own MMS cap is 2000; this stays comfortably inside it.
export const SMS_COMPOSED_MAX_LENGTH = 1000
export const SMS_BODY_MAX_LENGTH = 360

export const SmsDraftRequestSchema = z.object({
  purpose: SmsPurposeSchema,
  tone: SocialToneSchema,
  currentDraft: z.string().min(1).max(SMS_COMPOSED_MAX_LENGTH).optional(),
})
export type SmsDraftRequest = z.infer<typeof SmsDraftRequestSchema>

export const SmsDraftResponseSchema = z.object({
  draft: z.string().min(1).max(SMS_COMPOSED_MAX_LENGTH),
})
export type SmsDraftResponse = z.infer<typeof SmsDraftResponseSchema>
