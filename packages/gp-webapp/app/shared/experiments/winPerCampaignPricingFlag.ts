import { useFlagOn } from './FeatureFlagsProvider'

// UI-only: gp-api reads the same key to decide which plan state it writes, so
// this controls whether the new plan copy, pitches and gates are shown.
export const WIN_PER_CAMPAIGN_PRICING_FLAG_KEY = 'win_per_campaign_pricing'

interface UseWinPerCampaignPricingFlagResult {
  ready: boolean
  enabled: boolean
}

export const useWinPerCampaignPricingFlag = (
  trackExposure = true,
): UseWinPerCampaignPricingFlagResult => {
  const { ready, on } = useFlagOn(WIN_PER_CAMPAIGN_PRICING_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
