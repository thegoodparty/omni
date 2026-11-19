import { z } from 'zod'
import {
  CampaignPlanLevelSchema,
  PlanPricingModelSchema,
} from '../generated/enums'

export const CampaignPlanSchema = CampaignPlanLevelSchema
export type CampaignPlanName = z.infer<typeof CampaignPlanSchema>

export { PlanPricingModelSchema }

export const PlanPurchaseMetadataSchema = z.object({
  campaignId: z.number().int().positive(),
  plan: z.enum(['pro', 'team']),
})
export type PlanPurchaseMetadata = z.infer<typeof PlanPurchaseMetadataSchema>

export const CampaignPlanStateSchema = z.object({
  plan: CampaignPlanSchema,
  planPricingModel: PlanPricingModelSchema.nullable(),
  planPaidAt: z.string().datetime().nullable(),
  planEndsAt: z.string().datetime().nullable(),
  planEndedAt: z.string().datetime().nullable(),
  outreachCreditCents: z.number().int().min(0),
})
export type CampaignPlanState = z.infer<typeof CampaignPlanStateSchema>

export const AdminSetPlanSchema = z.object({
  plan: CampaignPlanSchema,
  creditCents: z.number().int().min(0).optional(),
  reason: z.string().min(1),
})
export type AdminSetPlan = z.infer<typeof AdminSetPlanSchema>

export const AdminExtendPlanSchema = z.object({
  endsAt: z.string().datetime().nullable(),
  reason: z.string().min(1),
})
export type AdminExtendPlan = z.infer<typeof AdminExtendPlanSchema>

export const AdminRefundPlanResponseSchema = z.object({
  refundedCents: z.number().int(),
  eligibility: z.object({
    daysSincePurchase: z.number().int(),
    outreachSent: z.boolean(),
  }),
})
export type AdminRefundPlanResponse = z.infer<
  typeof AdminRefundPlanResponseSchema
>
