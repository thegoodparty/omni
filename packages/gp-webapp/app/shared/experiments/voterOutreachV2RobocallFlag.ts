import { useFlagOn } from './FeatureFlagsProvider'

export const VOTER_OUTREACH_V2_ROBOCALL_FLAG_KEY = 'voter-outreach-v2-robocall'

interface UseVoterOutreachV2RobocallFlagResult {
  ready: boolean
  enabled: boolean
}

// The robocall tile-target swap flag: on, the robocall tile opens the new
// drawer flow; off (or unsettled), it launches the legacy robocall TaskFlow —
// the same fallback shape the social tile gets, so channels flip individually
// under the hub flag. The tile grid is the one divergence point.
export const useVoterOutreachV2RobocallFlag = (
  trackExposure = true,
): UseVoterOutreachV2RobocallFlagResult => {
  const { ready, on } = useFlagOn(VOTER_OUTREACH_V2_ROBOCALL_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
