import {
  Campaign,
  CampaignPlanLevel,
  PlanPricingModel,
} from '@/generated/prisma'

export type CampaignPlanState = Pick<
  Campaign,
  'plan' | 'planPricingModel' | 'planEndedAt'
>

export const holdsOneTimePlan = (campaign: CampaignPlanState) =>
  campaign.planPricingModel === PlanPricingModel.one_time &&
  !campaign.planEndedAt &&
  campaign.plan !== CampaignPlanLevel.free
