import { useFlagOn } from './FeatureFlagsProvider'

// Gates issue capture on the Serve side: after a knock or a call, the
// canvasser records a short spoken summary of what the constituent said, and
// the API extracts the issue, their position on it, and the outcome they want.
// gp-api gates the capture write route on the same key, so the surface and the
// API roll out together.
//
// Stacked under `native-door-knocking` on the door surface: capture lives
// inside the native walk experience, so a user without that flag never
// reaches it whatever this one says.
//
// The flag gates rollout, not access. serveAccess() on the client and
// @UseElectedOffice() at gp-api remain the real checks.
export const SERVE_ISSUE_CAPTURE_FLAG_KEY = 'serve-issue-capture'

interface UseServeIssueCaptureFlagResult {
  ready: boolean
  enabled: boolean
}

// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment — the capture card on the knock and call forms is the treatment
// surface, so it takes the default.
export const useServeIssueCaptureFlag = (
  trackExposure = true,
): UseServeIssueCaptureFlagResult => {
  const { ready, on } = useFlagOn(SERVE_ISSUE_CAPTURE_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
