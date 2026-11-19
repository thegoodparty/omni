'use client'

import { useWinPerCampaignPricingFlag } from '@shared/experiments/winPerCampaignPricingFlag'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'
import { buildPlanPitch, type PlanPitch } from './planPitch'

export const usePlanPitch = (): PlanPitch => {
  const { enabled } = useWinPerCampaignPricingFlag()
  const { recommendTeam } = usePlan()
  return buildPlanPitch(enabled, recommendTeam)
}
