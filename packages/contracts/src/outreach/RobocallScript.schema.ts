import { z } from 'zod'
import { SocialToneSchema } from './OutreachSocial.schema'

// Robocall script-draft purpose slugs, on the wire for
// POST /v1/outreach/robocall/draft. The webapp's robocallPurposes.ts maps
// these to the design's card copy. No "issue update" purpose (product call).
export const ROBOCALL_PURPOSE_VALUES = [
  'introduce_myself',
  'persuade_voters',
  'event_invite',
  'early_voting',
  'election_day_turnout',
  'custom',
] as const
export const RobocallPurposeSchema = z.enum(ROBOCALL_PURPOSE_VALUES)
export type RobocallPurpose = z.infer<typeof RobocallPurposeSchema>

export const ROBOCALL_SCRIPT_MAX_LENGTH = 2000

// currentDraft switches the endpoint from writing a fresh script to polishing
// the given text (keep meaning/structure/claims, apply tone) — mirrors the
// social draft's "Improve with AI" behavior.
export const RobocallScriptDraftRequestSchema = z.object({
  purpose: RobocallPurposeSchema,
  tone: SocialToneSchema,
  currentDraft: z.string().min(1).max(ROBOCALL_SCRIPT_MAX_LENGTH).optional(),
  // The rented caller-ID number the candidate will read aloud. When present,
  // the drafted script must END with the spoken FCC disclosure (who paid for
  // the call + this callback number); absent, no disclosure is added yet (the
  // number isn't rented until the candidate reaches the compose step).
  callbackNumber: z.string().min(1).max(32).optional(),
})
export type RobocallScriptDraftRequest = z.infer<
  typeof RobocallScriptDraftRequestSchema
>

export const RobocallScriptDraftResponseSchema = z.object({
  draft: z.string().min(1).max(ROBOCALL_SCRIPT_MAX_LENGTH),
})
export type RobocallScriptDraftResponse = z.infer<
  typeof RobocallScriptDraftResponseSchema
>
