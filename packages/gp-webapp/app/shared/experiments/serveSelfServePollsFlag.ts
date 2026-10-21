import { useFlagOn } from './FeatureFlagsProvider'

// Gates self-serve polls on Serve: the Poll / Survey tile, the create flow it
// opens, and the poll rows on the Polls page. gp-api gates
// POST /outreach/serve/poll/draft and POST /outreach/serve/poll on the same
// key, so the surface and the API roll out together.
//
// The flag gates rollout, not access. @UseElectedOffice() at gp-api remains
// the real check.
export const SERVE_SELF_SERVE_POLLS_FLAG_KEY = 'serve-self-serve-polls'

// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment — the tile that opens the flow is the treatment surface, so it
// takes the default.
export const useServeSelfServePollsFlag = (
  trackExposure = true,
): { ready: boolean; enabled: boolean } => {
  const { ready, on } = useFlagOn(SERVE_SELF_SERVE_POLLS_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
