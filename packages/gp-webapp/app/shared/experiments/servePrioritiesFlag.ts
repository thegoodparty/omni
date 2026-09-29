import { useFlagOn } from './FeatureFlagsProvider'

export const SERVE_PRIORITIES_FLAG_KEY = 'serve-priorities'

interface UseServePrioritiesFlagResult {
  ready: boolean
  enabled: boolean
}

// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment; the Priorities page is the treatment surface, the sidebar item
// that links to it is not.
export const useServePrioritiesFlag = (
  trackExposure = true,
): UseServePrioritiesFlagResult => {
  const { ready, on } = useFlagOn(SERVE_PRIORITIES_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
