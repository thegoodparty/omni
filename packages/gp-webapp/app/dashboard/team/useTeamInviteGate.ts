import { TEAM_GATE_START } from '@goodparty_org/contracts'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useWinPerCampaignPricingFlag } from '@shared/experiments/winPerCampaignPricingFlag'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'

// Mirrors the predicate on gp-api's POST team/invites: flag on, a campaign
// created on or after TEAM_GATE_START, and a plan other than Team.
export const useTeamInviteGate = (): { gated: boolean; plan: string } => {
  const [campaign] = useCampaign()
  const { enabled } = useWinPerCampaignPricingFlag()
  const { plan } = usePlan()
  const gated =
    enabled &&
    Boolean(campaign) &&
    new Date(campaign!.createdAt) >= new Date(TEAM_GATE_START) &&
    plan !== 'team'
  return { gated, plan }
}
