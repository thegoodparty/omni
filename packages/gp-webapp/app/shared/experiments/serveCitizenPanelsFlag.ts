import { useFlagOn } from './FeatureFlagsProvider'

// Gates the civic panel on Serve and everything that ships with it: the
// reframed onboarding and its priorities step, panel membership on the
// constituent record and in lists, joining from a text, a door or a call, the
// panel-first checks in the priorities flow, and what a priority's outreach
// brought back. Off, Serve reads exactly as it did before.
//
// The flag gates rollout, not access. @UseOrganization() and
// @UseElectedOffice() at gp-api remain the real checks.
export const SERVE_CITIZEN_PANELS_FLAG_KEY = 'serve-citizen-panels'

// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment.
export const useServeCitizenPanelsFlag = (
  trackExposure = true,
): { ready: boolean; enabled: boolean } => {
  const { ready, on } = useFlagOn(SERVE_CITIZEN_PANELS_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
