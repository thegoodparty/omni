import { z } from 'zod'

import { CAMPAIGN_STORY_FIELD_MAX_LENGTH } from './CampaignStory.schema'

/**
 * The AI-suggested rewrite of a single Campaign Story field. Returned by
 * gp-api's `POST /campaigns/mine/story/rewrite` and also used as the
 * structured-output schema for the underlying Gemini call. Bounded to the
 * stored-field max so any accepted rewrite is always persistable.
 */
export const CampaignStoryRewriteSchema = z.object({
  rewrite: z.string().max(CAMPAIGN_STORY_FIELD_MAX_LENGTH),
})

export type CampaignStoryRewrite = z.infer<typeof CampaignStoryRewriteSchema>
