import { z } from 'zod'
import {
  CampaignStorySchema,
  CAMPAIGN_STORY_FIELD_MAX_LENGTH,
} from '@goodparty_org/contracts'

// why/background are single-sourced from the contract so they can't drift from
// the stored story shape. 'issue' rewrites a website issue's "Policy focus"
// (shown on the candidate profile / Campaign Story page); it isn't a story
// field, so it's appended explicitly.
export const REWRITE_FIELDS = [
  ...CampaignStorySchema.keyof().options,
  'issue',
] as const

export const RewriteCampaignStorySchema = z.object({
  field: z.enum(REWRITE_FIELDS),
  // Trim first so whitespace-only input fails min(1) — there's nothing to
  // rewrite, so reject it rather than spend a Gemini call on blank text.
  text: z.string().trim().min(1).max(CAMPAIGN_STORY_FIELD_MAX_LENGTH),
  // Optional context: the policy title for an `issue` rewrite, so the prompt
  // stays anchored to that specific policy.
  title: z.string().trim().max(CAMPAIGN_STORY_FIELD_MAX_LENGTH).optional(),
})

export type RewriteCampaignStoryInput = z.infer<
  typeof RewriteCampaignStorySchema
>
