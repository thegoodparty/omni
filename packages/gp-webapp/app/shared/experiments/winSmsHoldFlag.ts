import { useFlagOn } from './FeatureFlagsProvider'

// Gates the Win p2p SMS hold-billing UI reorder: paying for a text send BEFORE
// its phone-list build is ready, priced off the pre-pay reachable-list estimate
// (a ceiling the later capture bills down to the actual count). gp-api runs the
// same rollout behind the `WIN_SMS_HOLD_BILLING` env flag (the hold, the
// pre-build estimate, the hard send cap, and the relaxed draft-create that
// accepts a null phoneListId); this client flag must be flipped in tandem so the
// UI only offers pay-before-ready when the API will accept it.
//
// The flag gates rollout, not access. It defaults OFF (useFlagOn reads off until
// a treatment exists), so the flow is the unchanged spinner-until-ready sequence
// until it is turned on.
export const WIN_SMS_HOLD_FLAG_KEY = 'win-sms-hold-billing'

interface UseWinSmsHoldFlagResult {
  ready: boolean
  enabled: boolean
}

// trackExposure=false on surfaces that read the flag but aren't the treatment —
// SmsFlow is shared with Serve, which is not in this experiment, so it reads the
// flag with exposure tracking off and only applies it on the Win surface.
export const useWinSmsHoldFlag = (
  trackExposure = true,
): UseWinSmsHoldFlagResult => {
  const { ready, on } = useFlagOn(WIN_SMS_HOLD_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
