import { useFlagOn } from './FeatureFlagsProvider'

// Gates the whole Serve SMS feature: texting constituents from an elected
// office, composed and paid for in the app and fulfilled through the shared
// delivery layer. gp-api gates the two entry routes
// (POST /outreach/serve/sms/draft and POST /outreach/serve/sms) on the same
// key, so the surface and the API roll out together.
//
// The flag gates rollout, not access. serveAccess() on the client and
// @UseElectedOffice() at gp-api remain the real checks.
export const SERVE_SMS_FLAG_KEY = 'serve-sms-outreach'

interface UseServeSmsFlagResult {
  ready: boolean
  enabled: boolean
}

// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment — the channel card that opens the flow is the treatment surface,
// so it takes the default.
export const useServeSmsFlag = (
  trackExposure = true,
): UseServeSmsFlagResult => {
  const { ready, on } = useFlagOn(SERVE_SMS_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
