import { z } from 'zod'

/**
 * The AI-suggested rewrite of a single Campaign Story field. Returned by
 * gp-api's `POST /campaigns/mine/story/rewrite` and also used as the
 * structured-output schema for the underlying Gemini call.
 */
export const CampaignStoryRewriteSchema = z.object({
  rewrite: z.string(),
})

export type CampaignStoryRewrite = z.infer<typeof CampaignStoryRewriteSchema>
