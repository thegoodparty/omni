import { z } from 'zod'
import { CampaignStorySchema } from '@goodparty_org/contracts'

// Matches the stored-field ceiling in updateCampaignStory.schema.ts — the
// text we rewrite is the same free-text the user typed into a story field.
const MAX_LENGTH = 10000

// Derived from CampaignStorySchema so the rewritable fields can't drift from
// the stored story shape — a new story field becomes rewritable automatically.
export const CAMPAIGN_STORY_FIELDS = CampaignStorySchema.keyof().options

export const RewriteCampaignStorySchema = z.object({
  field: z.enum(CAMPAIGN_STORY_FIELDS),
  // Trim first so whitespace-only input fails min(1) — there's nothing to
  // rewrite, so reject it rather than spend a Gemini call on blank text.
  text: z.string().trim().min(1).max(MAX_LENGTH),
})

export type RewriteCampaignStoryInput = z.infer<
  typeof RewriteCampaignStorySchema
>
