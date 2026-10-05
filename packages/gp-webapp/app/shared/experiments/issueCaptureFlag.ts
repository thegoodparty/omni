import { useFlagOn } from './FeatureFlagsProvider'

// Gates issue capture on Win and Serve alike: after a knock or a call, the
// canvasser records a short spoken summary of what the person said, and the
// API extracts the issues, their position on each, and the outcome they want.
// gp-api gates its capture routes on the same key, so the surface and the API
// roll out together.
//
// The flag gates rollout, not access. @UseOrganization() at gp-api and its
// role guard remain the real checks.
export const ISSUE_CAPTURE_FLAG_KEY = 'issue-capture'

// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment — the capture card on the knock and call forms is the treatment
// surface, so it takes the default.
export const useIssueCaptureFlag = (
  trackExposure = true,
): { ready: boolean; enabled: boolean } => {
  const { ready, on } = useFlagOn(ISSUE_CAPTURE_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
