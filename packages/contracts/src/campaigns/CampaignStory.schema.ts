import { z } from 'zod'

/**
 * A candidate's campaign story: the three free-text answers (why,
 * background, issues) shown on the Campaign Story page. Persisted 1:1 with
 * a campaign in gp-api's `campaign_story` table. A field is `null` (or an
 * empty string, if the candidate wrote then cleared it) when that section
 * has no content.
 */
export const CampaignStorySchema = z.object({
  why: z.string().nullable(),
  background: z.string().nullable(),
  issues: z.string().nullable(),
})

export type CampaignStory = z.infer<typeof CampaignStorySchema>
