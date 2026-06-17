import { useFlagOn } from './FeatureFlagsProvider'

// Gates the Chief of Staff dashboard (priorities, dashboard cards, general
// chat). Layered on top of serve-access + elected-office so it can be ramped
// to internal staff only, independently of the broader Serve rollout. Same key
// in dev + prod Amplitude environments; audience is targeted in Amplitude.
export const CHIEF_OF_STAFF_FLAG_KEY = 'chief-of-staff'

interface UseChiefOfStaffFlagResult {
  ready: boolean
  enabled: boolean
}

export const useChiefOfStaffFlag = (): UseChiefOfStaffFlagResult => {
  const { ready, on } = useFlagOn(CHIEF_OF_STAFF_FLAG_KEY)
  return { ready, enabled: on }
}
