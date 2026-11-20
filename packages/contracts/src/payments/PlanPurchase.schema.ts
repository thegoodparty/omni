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

export const AdminPlanRefundEligibilitySchema = z.object({
  refundable: z.boolean(),
  reason: z.enum(['NO_REFUNDABLE_PURCHASE', 'ACTIVE_SUBSCRIPTION']).nullable(),
  purchaseId: z.number().int().nullable(),
  kind: z.enum(['plan', 'team_upgrade']).nullable(),
  amountCents: z.number().int().nullable(),
  purchasedAt: z.string().nullable(),
  daysSincePurchase: z.number().int().nullable(),
  outreachSent: z.boolean().nullable(),
})
export type AdminPlanRefundEligibility = z.infer<
  typeof AdminPlanRefundEligibilitySchema
>

export const AdminRefundPlanResponseSchema = z.object({
  refundedCents: z.number().int(),
  eligibility: AdminPlanRefundEligibilitySchema,
})
export type AdminRefundPlanResponse = z.infer<
  typeof AdminRefundPlanResponseSchema
>
