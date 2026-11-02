import { useFlagOn } from './FeatureFlagsProvider'

// Gates the Win email outreach flow. UI-only: gp-api's email routes are not
// flag-gated, so this controls who is shown the surface.
export const WIN_EMAIL_OUTREACH_FLAG_KEY = 'win-email-outreach'

interface UseWinEmailOutreachFlagResult {
  ready: boolean
  enabled: boolean
}

export const useWinEmailOutreachFlag = (
  trackExposure = true,
): UseWinEmailOutreachFlagResult => {
  const { ready, on } = useFlagOn(WIN_EMAIL_OUTREACH_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
