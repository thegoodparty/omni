import { useFlagOn } from './FeatureFlagsProvider'

export const OUTREACH_PRO_GATING_V2_FLAG_KEY = 'outreach-pro-gating-v2'

interface UseOutreachProGatingV2FlagResult {
  ready: boolean
  enabled: boolean
}

// One flag selects the purchase-only Pro wizard, the membership banner and
// chip, and (milestone 2) the in-flow outreach gate. Every caller passes
// trackExposure=false; the membership banner and chip fire the exposure
// themselves, once, only when they actually render for the candidate.
export const useOutreachProGatingV2Flag = (
  trackExposure = true,
): UseOutreachProGatingV2FlagResult => {
  const { ready, on } = useFlagOn(OUTREACH_PRO_GATING_V2_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
