import { useFlagOn } from './FeatureFlagsProvider'

export const VOTER_OUTREACH_V2_SMS_FLAG_KEY = 'voter-outreach-v2-sms'

interface UseVoterOutreachV2SmsFlagResult {
  ready: boolean
  enabled: boolean
}

// The SMS tile-target swap flag (phase 2): on, the SMS tile opens the new
// drawer flow; off, it launches the legacy TaskFlow. The tile grid is the
// one divergence point and passes the default true.
export const useVoterOutreachV2SmsFlag = (
  trackExposure = true,
): UseVoterOutreachV2SmsFlagResult => {
  const { ready, on } = useFlagOn(VOTER_OUTREACH_V2_SMS_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
