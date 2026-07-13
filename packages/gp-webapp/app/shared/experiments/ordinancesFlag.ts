import { useFlagOn } from './FeatureFlagsProvider'

// Gates the whole Ordinances (Legislation) feature — gp-api endpoints, the
// ordinance_flow chat scope, and every /ordinances* route. Ships dark; ramps
// per user/org in Amplitude.
export const ORDINANCES_FLAG_KEY = 'serve-ordinances'

interface UseOrdinancesFlagResult {
  ready: boolean
  enabled: boolean
}

export const useOrdinancesFlag = (
  trackExposure = true,
): UseOrdinancesFlagResult => {
  const { ready, on } = useFlagOn(ORDINANCES_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
