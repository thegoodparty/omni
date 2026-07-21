import { useFlagOn } from './FeatureFlagsProvider'

export const NATIVE_DOOR_KNOCKING_FLAG_KEY = 'native-door-knocking'

interface UseNativeDoorKnockingFlagResult {
  ready: boolean
  enabled: boolean
}

// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment; the door-knocking page gate is the treatment surface.
export const useNativeDoorKnockingFlag = (
  trackExposure = true,
): UseNativeDoorKnockingFlagResult => {
  const { ready, on } = useFlagOn(NATIVE_DOOR_KNOCKING_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
