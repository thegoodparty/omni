import { z } from 'zod'
import { SocialToneSchema } from './OutreachSocial.schema'

export const SMS_PURPOSE_VALUES = [
  'introduce_myself',
  'persuade_voters',
  'event_invite',
  'early_voting',
  'election_day_turnout',
  'custom',
] as const
export const SmsPurposeSchema = z.enum(SMS_PURPOSE_VALUES)
export type SmsPurpose = z.infer<typeof SmsPurposeSchema>

// The UI cap is 480 chars for the composed message (intro + body +
// footer); the body cap leaves headroom for the system regions. Both sit
// far inside the backend's 2000-char script cap.
export const SMS_COMPOSED_MAX_LENGTH = 480
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
