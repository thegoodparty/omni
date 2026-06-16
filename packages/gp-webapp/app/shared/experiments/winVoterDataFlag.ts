import { useFlagOn } from './FeatureFlagsProvider'

export const WIN_VOTER_DATA_FLAG_KEY = 'win-voter-data'

interface UseWinVoterDataFlagResult {
  ready: boolean
  enabled: boolean
}

// Master gate for the "Win voter data on the People API" rollout. Downstream
// tasks gate menu, route, and component surfaces on this single helper so the
// whole feature flips with one flag. Defaults off (useFlagOn falls back to
// 'off'), so nothing is reachable until the flag is turned on.
//
// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment (e.g. the dashboard menu), so the read doesn't inflate the exposed
// population.
export const useWinVoterDataFlag = (
  trackExposure = true,
): UseWinVoterDataFlagResult => {
  const { ready, on } = useFlagOn(WIN_VOTER_DATA_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
