import { useWinPerCampaignPricingFlag } from '@shared/experiments/winPerCampaignPricingFlag'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'
import { buildPlanPitch, type PlanPitch } from './planPitch'

export const usePlanPitch = (): PlanPitch => {
  const { ready, enabled } = useWinPerCampaignPricingFlag()
  const { recommendTeam } = usePlan()
  return buildPlanPitch(ready, enabled, recommendTeam)
}

// Gates, modals and agent cards sell Pro whatever the race size: the user is
// there to unlock one thing, and Team is cross-sold when they add members.
// Only the sidebar banner and chip use `usePlanPitch`; the plans page reads
// `recommendTeam` from `usePlan` itself.
export const useContextualPlanPitch = (): PlanPitch => {
  const { ready, enabled } = useWinPerCampaignPricingFlag()
  return buildPlanPitch(ready, enabled, false)
}
