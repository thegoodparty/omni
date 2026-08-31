import { useFlagOn } from './FeatureFlagsProvider'

export const SERVE_OUTREACH_FLAG_KEY = 'serve-outreach'

interface UseServeOutreachFlagResult {
  ready: boolean
  enabled: boolean
}

// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment. The constituent-outreach page's FeatureFlagGuard is the one
// treatment/control divergence point and passes the default true.
export const useServeOutreachFlag = (
  trackExposure = true,
): UseServeOutreachFlagResult => {
  const { ready, on } = useFlagOn(SERVE_OUTREACH_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
