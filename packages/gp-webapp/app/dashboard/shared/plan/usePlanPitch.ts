import { useWinPerCampaignPricingFlag } from '@shared/experiments/winPerCampaignPricingFlag'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'
import { buildPlanPitch, type PlanPitch } from './planPitch'

export const usePlanPitch = (): PlanPitch => {
  const { ready, enabled } = useWinPerCampaignPricingFlag()
  const { recommendTeam } = usePlan()
  return buildPlanPitch(ready, enabled, recommendTeam)
}
