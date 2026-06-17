import { z } from 'zod'

export const UpdateCampaignStorySchema = z.object({
  why: z.string().optional(),
  background: z.string().optional(),
  issues: z.string().optional(),
})

export type UpdateCampaignStoryInput = z.infer<typeof UpdateCampaignStorySchema>
