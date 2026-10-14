import { useFlagOn } from './FeatureFlagsProvider'

// Gates the Win p2p SMS hold-billing UI reorder: paying for a text send BEFORE
// its phone-list build is ready, priced off the pre-pay reachable-list estimate
// (a ceiling the later capture bills down to the actual count). gp-api runs the
// same rollout behind the managed Amplitude flag `win_sms_hold_billing`
// (evaluated per-user via FeaturesService at entry: checkout-session creation,
// the draft phoneListId relaxation, the buildId acceptance, and the async
// build decision); this client flag must read the SAME key so the UI only
// offers pay-before-ready when the API will accept it. The key is snake_case
// because that is the literal Amplitude flag key (all-caps was rejected by
// Amplitude).
export const WIN_SMS_HOLD_FLAG_KEY = 'win_sms_hold_billing'

interface UseWinSmsHoldFlagResult {
  ready: boolean
  enabled: boolean
}

// trackExposure=false on surfaces that read the flag but aren't the treatment —
// SmsFlow is shared with Serve, which is not in this experiment.
export const useWinSmsHoldFlag = (
  trackExposure = true,
): UseWinSmsHoldFlagResult => {
  const { ready, on } = useFlagOn(WIN_SMS_HOLD_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
