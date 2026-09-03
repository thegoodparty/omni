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
// The treatment surface is the wizard's voter-file filter step, which is the
// only place the groups render. CreateListWizard reads this with
// trackExposure=false — its read only computes a prop, and the component
// stays mounted for the whole contacts page — and fires the exposure itself
// once that step is on screen.
export const useWinRecommendedListsFlag = (
  trackExposure = true,
): UseWinRecommendedListsFlagResult => {
  const { ready, on } = useFlagOn(WIN_RECOMMENDED_LISTS_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
