import { z } from 'zod'
import { CampaignSchema } from './Campaign.schema'

export const UpdateCampaignM2MSchema = CampaignSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
  isPro: true,
  vendorTsData: true,
  // Plan and credit state change only through setIsPro and the admin plan
  // routes, which hold the row lock and fire the analytics.
  plan: true,
  planPricingModel: true,
  planPaidAt: true,
  planEndsAt: true,
  planEndedAt: true,
  outreachCreditCents: true,
  hasFreeTextsOffer: true,
  freeTextsOfferRedeemedAt: true,
})
  .partial()
  .extend({
    // Staff's answer when a new election date would clear the last
    // election's result. Omitted, gp-api decides from the request.
    resetElectionResults: z.boolean().optional(),
  })

export type UpdateCampaignM2MInput = z.infer<typeof UpdateCampaignM2MSchema>
