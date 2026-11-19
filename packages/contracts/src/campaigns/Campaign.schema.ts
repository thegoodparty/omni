import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import { CampaignTierSchema } from '../generated/enums'
import {
  CampaignPlanSchema,
  PlanPricingModelSchema,
} from '../payments/PlanPurchase.schema'
import type { CampaignData, CampaignDetails } from './types'

export const CampaignSchema = z.object({
  id: z.number(),
  createdAt: zCoerceDate(),
  updatedAt: zCoerceDate(),
  slug: z.string(),
  isActive: z.boolean(),
  isVerified: z.boolean().nullish(),
  isPro: z.boolean().nullish(),
  isDemo: z.boolean(),
  didWin: z.boolean().nullish(),
  primaryResult: z.enum(['won', 'lost']).nullish(),
  dateVerified: zCoerceDate().nullish(),
  tier: CampaignTierSchema.nullish(),
  formattedAddress: z.string().nullish(),
  placeId: z.string().nullish(),
  data: z.record(z.string(), z.unknown()),
  details: z.record(z.string(), z.unknown()),
  vendorTsData: z.record(z.string(), z.unknown()),
  userId: z.number(),
  canDownloadFederal: z.boolean(),
  completedTaskIds: z.array(z.string()),
  hasFreeTextsOffer: z.boolean(),
  freeTextsOfferRedeemedAt: zCoerceDate().nullish(),
  plan: CampaignPlanSchema.optional(),
  planPricingModel: PlanPricingModelSchema.nullish(),
  planPaidAt: zCoerceDate().nullish(),
  planEndsAt: zCoerceDate().nullish(),
  planEndedAt: zCoerceDate().nullish(),
  outreachCreditCents: z.number().int().min(0).optional(),
  derp: z.string().optional(),
})

export type ReadCampaignOutput = Omit<
  z.infer<typeof CampaignSchema>,
  'vendorTsData' | 'data' | 'details'
> & {
  data: CampaignData
  details: CampaignDetails
  derp?: string
}
