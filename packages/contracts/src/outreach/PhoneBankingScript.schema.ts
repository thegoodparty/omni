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
export const PHONE_BANKING_INSTRUCTIONS_MAX_LENGTH = 500

// currentDraft switches the endpoint from writing a fresh script to
// polishing the given text (keep meaning/structure/claims, apply tone) —
// mirrors the social draft's "Improve with AI" behavior. previousDraft is
// distinct: it rides along on a FRESH generation (Regenerate, or a tone
// change) to tell the model what the candidate just rejected, so the re-roll
// varies instead of converging on the same script (ENG-10937). instructions
// is the candidate's own freeform steering, applied on either path
// (ENG-10936).
export const PhoneBankingScriptDraftRequestSchema = z
  .object({
    purpose: PhoneBankingScriptPurposeSchema,
    tone: SocialToneSchema,
    currentDraft: z
      .string()
      .min(1)
      .max(PHONE_BANKING_SCRIPT_MAX_LENGTH)
      .optional(),
    previousDraft: z.string().max(PHONE_BANKING_SCRIPT_MAX_LENGTH).optional(),
    // Whitespace-only is treated as absent, not a violation — a trim-then-
    // min(1) without this transform 400s on '   ' even though the field is
    // optional, since the client has no way to distinguish "blank" from a
    // real schema violation.
    instructions: z
      .string()
      .trim()
      .max(PHONE_BANKING_INSTRUCTIONS_MAX_LENGTH)
      .transform((v) => (v.length === 0 ? undefined : v))
      .optional(),
  })
  // The two paths are mutually exclusive by construction (the service picks
  // improve vs. fresh generation off currentDraft alone, so a previousDraft
  // riding alongside currentDraft would be silently dropped) — reject the
  // combination instead of accepting and ignoring it.
  .refine(
    (v) => v.currentDraft === undefined || v.previousDraft === undefined,
    {
      message: 'currentDraft and previousDraft are mutually exclusive',
      path: ['previousDraft'],
    },
  )
export type PhoneBankingScriptDraftRequest = z.infer<
  typeof PhoneBankingScriptDraftRequestSchema
>

export const PhoneBankingScriptDraftResponseSchema = z.object({
  draft: z.string().min(1).max(PHONE_BANKING_SCRIPT_MAX_LENGTH),
})
export type PhoneBankingScriptDraftResponse = z.infer<
  typeof PhoneBankingScriptDraftResponseSchema
>
