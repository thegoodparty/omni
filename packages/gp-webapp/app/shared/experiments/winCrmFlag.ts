import { useFlagOn } from './FeatureFlagsProvider'

export const WIN_CRM_FLAG_KEY = 'win-crm'

interface UseWinCrmFlagResult {
  ready: boolean
  enabled: boolean
}

// Gate for every Win-facing CRM surface, layered on (never replacing) the
// existing Win gates: the win-voter-data flag plus Pro for individual rows.
// Defaults off (useFlagOn falls back to 'off'), so no CRM surface is reachable
// until the flag is turned on.
//
// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment (e.g. the dashboard menu), so the read doesn't inflate the exposed
// population.
export const useWinCrmFlag = (trackExposure = true): UseWinCrmFlagResult => {
  const { ready, on } = useFlagOn(WIN_CRM_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
