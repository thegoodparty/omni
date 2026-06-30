import { z } from 'zod'
import { CAMPAIGN_STORY_FIELD_MAX_LENGTH } from '@goodparty_org/contracts'

// Generous ceiling — the UI suggests ~100 chars but doesn't enforce it. This
// only bounds stored text so an oversized body can't bloat the row.
const MAX_LENGTH = CAMPAIGN_STORY_FIELD_MAX_LENGTH

// Trim on ingress so whitespace-only input normalizes to '' (the canonical
// "cleared" value) — otherwise it stores verbatim and the webapp's trimmed
// completeness check would never count it, silently stranding the user.
const trimmed = (s: string): string => s.trim()

export const UpdateCampaignStorySchema = z
  .object({
    why: z.string().max(MAX_LENGTH).transform(trimmed).optional(),
    background: z.string().max(MAX_LENGTH).transform(trimmed).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'At least one of why or background must be provided',
  })

export type UpdateCampaignStoryInput = z.infer<typeof UpdateCampaignStorySchema>
