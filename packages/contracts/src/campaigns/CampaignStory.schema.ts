import { z } from 'zod'

// Canonical max length for a stored Campaign Story field. The single source
// of truth for both the input cap (gp-api's update/rewrite schemas) and the
// rewrite output cap, so they can't drift.
export const CAMPAIGN_STORY_FIELD_MAX_LENGTH = 10000

/**
 * A candidate's campaign story: the free-text `why` and `background` answers
 * shown on the Campaign Story page. Persisted 1:1 with a campaign in gp-api's
 * `campaign_story` table. A field is `null` (or an empty string, if the
 * candidate wrote then cleared it) when that section has no content. The
 * candidate's issues are NOT part of the story — they live on the website
 * (`Website.content.about.issues`), shared with the Pro-upgrade flow.
 */
export const CampaignStorySchema = z.object({
  why: z.string().nullable(),
  background: z.string().nullable(),
})

export type CampaignStory = z.infer<typeof CampaignStorySchema>
