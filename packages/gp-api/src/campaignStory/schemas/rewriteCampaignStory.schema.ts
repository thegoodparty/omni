import { z } from 'zod'
import { CAMPAIGN_STORY_FIELD_MAX_LENGTH } from '@goodparty_org/contracts'

// The rewritable prompts. `why` (now the website bio) and `background` are the
// Campaign Story prompts; `issue` rewrites a website issue's "Policy focus"
// (candidate profile / Campaign Story page). `why` is no longer a CampaignStory
// column, so the set is listed explicitly rather than derived from the schema.
export const REWRITE_FIELDS = ['why', 'background', 'issue'] as const

export const RewriteCampaignStorySchema = z
  .object({
    field: z.enum(REWRITE_FIELDS),
    // Trim first so whitespace-only input fails min(1) — there's nothing to
    // rewrite, so reject it rather than spend a Gemini call on blank text.
    text: z.string().trim().min(1).max(CAMPAIGN_STORY_FIELD_MAX_LENGTH),
    // Optional context: the policy title for an `issue` rewrite, so the prompt
    // stays anchored to that specific policy.
    title: z.string().trim().max(CAMPAIGN_STORY_FIELD_MAX_LENGTH).optional(),
  })
  // `title` is only context for an issue rewrite — reject it elsewhere so an
  // arbitrary string can't be interpolated into the why/background prompt.
  .refine((val) => val.field === 'issue' || val.title === undefined, {
    message: 'title is only valid when field is issue',
    path: ['title'],
  })

export type RewriteCampaignStoryInput = z.infer<
  typeof RewriteCampaignStorySchema
>
