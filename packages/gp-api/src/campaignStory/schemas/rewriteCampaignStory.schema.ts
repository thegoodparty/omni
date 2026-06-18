import { z } from 'zod'

// Matches the stored-field ceiling in updateCampaignStory.schema.ts — the
// text we rewrite is the same free-text the user typed into a story field.
const MAX_LENGTH = 10000

// The three Campaign Story fields, mirrored from the webapp's
// CAMPAIGN_STORY_SECTIONS. Drives which section guidance the prompt uses.
export const CAMPAIGN_STORY_FIELDS = ['why', 'background', 'issues'] as const

export const RewriteCampaignStorySchema = z.object({
  field: z.enum(CAMPAIGN_STORY_FIELDS),
  // Trim first so whitespace-only input fails min(1) — there's nothing to
  // rewrite, so reject it rather than spend a Gemini call on blank text.
  text: z.string().trim().min(1).max(MAX_LENGTH),
})

export type RewriteCampaignStoryInput = z.infer<
  typeof RewriteCampaignStorySchema
>
