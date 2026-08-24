import { z } from 'zod'
import { SocialToneSchema } from './OutreachSocial.schema'
import {
  PhoneBankingPurposeSchema,
  type PhoneBankingPurpose,
} from '../phoneBanking/PhoneBankingCreate.schema'

// Same six purpose values as PhoneBankingCreateSchema's audience step
// (canonical definition lives in phoneBanking/PhoneBankingCreate.schema.ts);
// kept under this module's own names since outreachPhoneBankingGeneration
// .service.ts imports them from here.
export const PhoneBankingScriptPurposeSchema = PhoneBankingPurposeSchema
export type PhoneBankingScriptPurpose = PhoneBankingPurpose

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
