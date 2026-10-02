import { useServeIssueCaptureFlag } from './serveIssueCaptureFlag'
import { useWinIssueCaptureFlag } from './winIssueCaptureFlag'

// Issue capture for whichever product the surface belongs to. The knock and
// call forms are shared by Win and Serve, and each product rolls out on its
// own flag, so the surface passes the product it already knows.
//
// Both flags are read because a hook cannot be called conditionally, but only
// the product's own is allowed to expose the user: a Serve official must not
// be counted in Win's rollout, nor a candidate in Serve's.
export const useIssueCaptureFlag = (
  isServe: boolean,
  trackExposure = true,
): { ready: boolean; enabled: boolean } => {
  const serve = useServeIssueCaptureFlag(trackExposure && isServe)
  const win = useWinIssueCaptureFlag(trackExposure && !isServe)
  return isServe ? serve : win
}
