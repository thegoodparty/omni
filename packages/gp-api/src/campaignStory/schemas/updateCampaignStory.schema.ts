import { z } from 'zod'

// Generous ceiling — the UI suggests ~100 chars but doesn't enforce it. This
// only bounds stored text so an oversized body can't bloat the row.
const MAX_LENGTH = 10000

export const UpdateCampaignStorySchema = z.object({
  why: z.string().max(MAX_LENGTH).optional(),
  background: z.string().max(MAX_LENGTH).optional(),
  issues: z.string().max(MAX_LENGTH).optional(),
})

export type UpdateCampaignStoryInput = z.infer<typeof UpdateCampaignStorySchema>
