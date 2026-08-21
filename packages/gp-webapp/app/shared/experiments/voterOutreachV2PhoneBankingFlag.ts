import { useFlagOn } from './FeatureFlagsProvider'

export const VOTER_OUTREACH_V2_PHONE_BANKING_FLAG_KEY =
  'voter-outreach-v2-phone-banking'

interface UseVoterOutreachV2PhoneBankingFlagResult {
  ready: boolean
  enabled: boolean
}

// The phone-banking tile-target swap flag: on, the tile opens the new
// PhoneBankingFlow drawer; off (or unsettled), it launches the legacy
// phoneBanking TaskFlow — same shape as voterOutreachV2SocialFlag. The tile
// grid is the one divergence point and passes the default true.
export const useVoterOutreachV2PhoneBankingFlag = (
  trackExposure = true,
): UseVoterOutreachV2PhoneBankingFlagResult => {
  const { ready, on } = useFlagOn(VOTER_OUTREACH_V2_PHONE_BANKING_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
