import { useFlagOn } from './FeatureFlagsProvider'

export const SERVE_CRM_FLAG_KEY = 'serve-crm'

interface UseServeCrmFlagResult {
  ready: boolean
  enabled: boolean
}

// Gate for the Serve CRM core, layered on (never replacing) the existing Serve
// gate: the eo- org's elected-office existence. Defaults off (useFlagOn falls
// back to 'off'), so no CRM surface is reachable until the flag is turned on.
//
// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment (e.g. the dashboard menu), so the read doesn't inflate the exposed
// population.
export const useServeCrmFlag = (
  trackExposure = true,
): UseServeCrmFlagResult => {
  const { ready, on } = useFlagOn(SERVE_CRM_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
