import { useFlagOn } from './FeatureFlagsProvider'

// Gates issue capture on the Win side: after a knock or a call, the canvasser
// records a short spoken summary of what the voter said, and the API extracts
// the issue, their position on it, and the outcome they want. gp-api gates a
// campaign org's capture routes on the same key, so the surface and the API
// roll out together. Serve rolls out separately on `serve-issue-capture`.
//
// The flag gates rollout, not access. @UseOrganization() at gp-api and its
// role guard remain the real checks.
export const WIN_ISSUE_CAPTURE_FLAG_KEY = 'win-issue-capture'

interface UseWinIssueCaptureFlagResult {
  ready: boolean
  enabled: boolean
}

// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment — the capture card on the knock and call forms is the treatment
// surface, so it takes the default.
export const useWinIssueCaptureFlag = (
  trackExposure = true,
): UseWinIssueCaptureFlagResult => {
  const { ready, on } = useFlagOn(WIN_ISSUE_CAPTURE_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
