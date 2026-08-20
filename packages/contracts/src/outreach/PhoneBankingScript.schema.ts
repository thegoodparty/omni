import { z } from 'zod'
import { SocialToneSchema } from './OutreachSocial.schema'

export const PHONE_BANKING_PURPOSE_VALUES = [
  'introduce',
  'persuade',
  'event',
  'vote-early',
  'election-day',
  'custom',
] as const
export const PhoneBankingScriptPurposeSchema = z.enum(
  PHONE_BANKING_PURPOSE_VALUES,
)
export type PhoneBankingScriptPurpose = z.infer<
  typeof PhoneBankingScriptPurposeSchema
>

export const PHONE_BANKING_SCRIPT_MAX_LENGTH = 2000

// currentDraft switches the endpoint from writing a fresh script to
// polishing the given text (keep meaning/structure/claims, apply tone) —
// mirrors the social draft's "Improve with AI" behavior.
export const PhoneBankingScriptDraftRequestSchema = z.object({
  purpose: PhoneBankingScriptPurposeSchema,
  tone: SocialToneSchema,
  currentDraft: z
    .string()
    .min(1)
    .max(PHONE_BANKING_SCRIPT_MAX_LENGTH)
    .optional(),
})
export type PhoneBankingScriptDraftRequest = z.infer<
  typeof PhoneBankingScriptDraftRequestSchema
>

export const PhoneBankingScriptDraftResponseSchema = z.object({
  draft: z.string().min(1).max(PHONE_BANKING_SCRIPT_MAX_LENGTH),
})
export type PhoneBankingScriptDraftResponse = z.infer<
  typeof PhoneBankingScriptDraftResponseSchema
>
