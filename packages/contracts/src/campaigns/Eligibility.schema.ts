import { z } from 'zod'

export const EligibilitySchema = z.object({
  hasActiveCampaign: z.boolean(),
  holdsOffice: z.boolean(),
  canStartCampaign: z.boolean(),
  canGainOffice: z.boolean(),
  reelectionOfficeSlug: z.string().nullable(),
})

export type Eligibility = z.infer<typeof EligibilitySchema>
