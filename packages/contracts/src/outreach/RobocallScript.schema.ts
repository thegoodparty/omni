import { z } from 'zod'
import { SocialToneSchema } from './OutreachSocial.schema'
import { OUTREACH_PURPOSE_VALUES } from './OutreachPurpose.schema'
import { ROBOCALL_SCRIPT_MAX_LENGTH } from './OutreachScript.const'

// Robocall script-draft purpose slugs, on the wire for
// POST /v1/outreach/robocall/draft. The webapp's robocallPurposes.ts maps
// these to the design's card copy. No "issue update" purpose (product call).
// Shares the canonical vocabulary (OutreachPurpose.schema.ts) with every
// other outreach channel.
export const ROBOCALL_PURPOSE_VALUES = OUTREACH_PURPOSE_VALUES
export const RobocallPurposeSchema = z.enum(ROBOCALL_PURPOSE_VALUES)
export type RobocallPurpose = z.infer<typeof RobocallPurposeSchema>

export { ROBOCALL_SCRIPT_MAX_LENGTH }

// currentDraft switches the endpoint from writing a fresh script to polishing
// the given text (keep meaning/structure/claims, apply tone) — mirrors the
// social draft's "Improve with AI" behavior.
export const RobocallScriptDraftRequestSchema = z.object({
  purpose: RobocallPurposeSchema,
  tone: SocialToneSchema,
  // On Improve, the whole script, disclosure line included: gp-api hides the
  // parts deriveRobocallProtectedParts locks from the model and restores them.
  currentDraft: z.string().min(1).max(ROBOCALL_SCRIPT_MAX_LENGTH).optional(),
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
