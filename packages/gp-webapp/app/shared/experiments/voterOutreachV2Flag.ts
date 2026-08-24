import { useFlagOn } from './FeatureFlagsProvider'

export const VOTER_OUTREACH_V2_FLAG_KEY = 'voter-outreach-v2'

interface UseVoterOutreachV2FlagResult {
  ready: boolean
  enabled: boolean
}

// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment. OutreachPageGate is the one treatment/control divergence point
// and passes the default true.
export const useVoterOutreachV2Flag = (
  trackExposure = true,
): UseVoterOutreachV2FlagResult => {
  const { ready, on } = useFlagOn(VOTER_OUTREACH_V2_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
