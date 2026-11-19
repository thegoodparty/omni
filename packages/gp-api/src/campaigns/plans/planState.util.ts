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

// What setIsPro reads under the campaign row lock, so a caller's `data`
// function can re-decide on the live row rather than on what it selected
// earlier.
export type LockedCampaignState = CampaignPlanState &
  Pick<
    Campaign,
    'isPro' | 'planEndsAtOverride' | 'details' | 'outreachCreditCents'
  >
