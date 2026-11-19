import type { CampaignPlanName } from '@goodparty_org/contracts'

// A Pro campaign that predates the plan columns, or was flipped by the
// subscription path, still reads `free` in the database; isPro decides.
export const identifyPlan = (campaign: {
  plan: CampaignPlanName
}): CampaignPlanName => (campaign.plan === 'free' ? 'pro' : campaign.plan)
