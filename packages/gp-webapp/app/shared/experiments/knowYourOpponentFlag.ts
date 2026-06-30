import { useFlagOn } from './FeatureFlagsProvider'

// Gates the internal, read-only race-opponent page (the Phase-0 stand-in for the
// end-state /opponent view). When on, the dashboard surfaces the "Know your
// opponent" nav item + page for Pro and non-Pro campaigns alike; non-Pro
// candidates see a locked upgrade view in place of the feature (Pro is gated at
// the route content, not the nav). Same key in dev + prod Amplitude environments.
export const KNOW_YOUR_OPPONENT_FLAG_KEY = 'win-know-your-opponent'

interface UseKnowYourOpponentFlagResult {
  ready: boolean
  enabled: boolean
}

export const useKnowYourOpponentFlag = (
  trackExposure = true,
): UseKnowYourOpponentFlagResult => {
  const { ready, on } = useFlagOn(KNOW_YOUR_OPPONENT_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
