import { useFlagOn } from './FeatureFlagsProvider'

// Gates the Serve email outreach flow. UI-only: gp-api's email routes are not
// flag-gated, so this controls who is shown the surface.
export const SERVE_EMAIL_OUTREACH_FLAG_KEY = 'serve-email-outreach'

interface UseServeEmailOutreachFlagResult {
  ready: boolean
  enabled: boolean
}

export const useServeEmailOutreachFlag = (
  trackExposure = true,
): UseServeEmailOutreachFlagResult => {
  const { ready, on } = useFlagOn(SERVE_EMAIL_OUTREACH_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
