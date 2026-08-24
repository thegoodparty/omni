import { useFlagOn } from './FeatureFlagsProvider'

export const VOTER_OUTREACH_V2_SOCIAL_FLAG_KEY = 'voter-outreach-v2-social'

interface UseVoterOutreachV2SocialFlagResult {
  ready: boolean
  enabled: boolean
}

// The social tile-target swap flag: on, the social tile opens the new
// drawer flow; off (or unsettled), it launches the legacy socialMedia
// TaskFlow — so the hub flag can release the new dashboard with 100%
// legacy behavior underneath, and channels flip individually. The tile
// grid is the one divergence point and passes the default true.
export const useVoterOutreachV2SocialFlag = (
  trackExposure = true,
): UseVoterOutreachV2SocialFlagResult => {
  const { ready, on } = useFlagOn(VOTER_OUTREACH_V2_SOCIAL_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
