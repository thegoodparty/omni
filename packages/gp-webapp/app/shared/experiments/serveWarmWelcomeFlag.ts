import { useFlagOn } from './FeatureFlagsProvider'

// Gates the warm welcome: the Serve onboarding a candidate sees right after
// they win. On, an office that came from a win opens it in place of the
// stepper onboarding. Off, Serve onboarding reads exactly as it did before.
//
// The flag gates rollout, not access. The page guard and
// @UseElectedOffice() at gp-api remain the real checks.
export const SERVE_WARM_WELCOME_FLAG_KEY = 'serve-warm-welcome'

export const useServeWarmWelcomeFlag = (
  trackExposure = true,
): { ready: boolean; enabled: boolean } => {
  const { ready, on } = useFlagOn(SERVE_WARM_WELCOME_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
