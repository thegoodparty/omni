import type { CampaignPlanName } from '@goodparty_org/contracts'
import { useWinPerCampaignPricingFlag } from '@shared/experiments/winPerCampaignPricingFlag'
import { useCampaign } from '@shared/hooks/useCampaign'
import { usePlan } from '../membership/deriveMembershipState'

// With the flag off the badge is today's isPro one. A legacy subscriber reads
// pro from usePlan, so their badge never changes.
export const useBadgePlan = (): CampaignPlanName => {
  const { enabled } = useWinPerCampaignPricingFlag(false)
  const [campaign] = useCampaign()
  const { plan } = usePlan()
  if (!enabled) return campaign?.isPro ? 'pro' : 'free'
  // The expiry sweep leaves `plan` set and clears isPro.
  if (campaign?.planEndedAt && !campaign.isPro) return 'free'
  return plan
}
