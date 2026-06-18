import { z } from 'zod'

// Must stay in step with the story field save cap (gp-api's
// updateCampaignStory.schema). A rewrite longer than the PUT limit would pass
// here but fail to persist when the user clicks "Use this", so bound it to
// guarantee any accepted rewrite is saveable. Doubles as a ceiling on Gemini's
// structured output.
const MAX_LENGTH = 10000

/**
 * The AI-suggested rewrite of a single Campaign Story field. Returned by
 * gp-api's `POST /campaigns/mine/story/rewrite` and also used as the
 * structured-output schema for the underlying Gemini call.
 */
export const CampaignStoryRewriteSchema = z.object({
  rewrite: z.string().max(MAX_LENGTH),
})

export type CampaignStoryRewrite = z.infer<typeof CampaignStoryRewriteSchema>
