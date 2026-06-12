import { z } from 'zod'

export const CreateCampaignPlanShareOutputSchema = z.object({
  url: z.string().url(),
})
