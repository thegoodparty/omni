import { useFlagOn } from './FeatureFlagsProvider'

export const WIN_RECOMMENDED_LISTS_FLAG_KEY = 'win-recommended-lists'

interface UseWinRecommendedListsFlagResult {
  ready: boolean
  enabled: boolean
}

// Gates the recommended-lists filter dimensions in the list wizard only. The
// dimensions themselves ship ungated end to end (persisted columns, filter
// translation, SQL), so a list saved while the flag was on keeps resolving
// after it flips off — this decides visibility, never behavior.
//
// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment; the wizard's filter step is the treatment surface.
export const useWinRecommendedListsFlag = (
  trackExposure = true,
): UseWinRecommendedListsFlagResult => {
  const { ready, on } = useFlagOn(WIN_RECOMMENDED_LISTS_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
