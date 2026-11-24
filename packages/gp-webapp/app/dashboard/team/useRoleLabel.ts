import { useWinPerCampaignPricingFlag } from '@shared/experiments/winPerCampaignPricingFlag'
import { roleLabel } from './team.util'

// The role label for display, sentence-cased under win_per_campaign_pricing.
// Reads the flag without exposure: the label is not the experiment's surface.
export const useRoleLabel = (): ((role: string) => string) => {
  const { enabled } = useWinPerCampaignPricingFlag(false)
  return (role) => roleLabel(role, enabled)
}
