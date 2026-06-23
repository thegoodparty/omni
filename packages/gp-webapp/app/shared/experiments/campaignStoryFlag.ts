import { useFlagOn } from './FeatureFlagsProvider'

export const CAMPAIGN_STORY_FLAG_KEY = 'campaign-story'

interface UseCampaignStoryFlagResult {
  ready: boolean
  enabled: boolean
}

// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment (e.g. the dashboard menu), so the read doesn't inflate the exposed
// population. The page itself (via FeatureFlagGuard) is the treatment surface.
export const useCampaignStoryFlag = (
  trackExposure = true,
): UseCampaignStoryFlagResult => {
  const { ready, on } = useFlagOn(CAMPAIGN_STORY_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
