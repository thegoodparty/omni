import { z } from 'zod'
import { CampaignSchema } from './Campaign.schema'

export const UpdateCampaignM2MSchema = CampaignSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
  vendorTsData: true,
})
  .partial()
  .extend({
    // Staff's answer when a new election date would clear the last
    // election's result. Omitted, gp-api decides from the request.
    resetElectionResults: z.boolean().optional(),
  })

export type UpdateCampaignM2MInput = z.infer<typeof UpdateCampaignM2MSchema>
