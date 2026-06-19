import { z } from 'zod'
import {
  CampaignStorySchema,
  CAMPAIGN_STORY_FIELD_MAX_LENGTH,
} from '@goodparty_org/contracts'

// Derived from CampaignStorySchema so the rewritable fields can't drift from
// the stored story shape — a new story field becomes rewritable automatically.
export const CAMPAIGN_STORY_FIELDS = CampaignStorySchema.keyof().options

export const RewriteCampaignStorySchema = z.object({
  field: z.enum(CAMPAIGN_STORY_FIELDS),
  // Trim first so whitespace-only input fails min(1) — there's nothing to
  // rewrite, so reject it rather than spend a Gemini call on blank text.
  text: z.string().trim().min(1).max(CAMPAIGN_STORY_FIELD_MAX_LENGTH),
})

export type RewriteCampaignStoryInput = z.infer<
  typeof RewriteCampaignStorySchema
>
