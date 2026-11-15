import { useFlagOn } from './FeatureFlagsProvider'

// Gates the Win text preview step, the candidate's own script edit and the
// results view. gp-api reads the same key for the script edit route, so the
// UI only offers what the API will accept.
export const WIN_SMS_PREVIEW_EDIT_FLAG_KEY = 'win-sms-preview-edit-results'

interface UseWinSmsPreviewEditFlagResult {
  ready: boolean
  enabled: boolean
}

// trackExposure=false on surfaces that read the flag but aren't the treatment:
// SmsFlow is shared with Serve, which is not in this experiment.
export const useWinSmsPreviewEditFlag = (
  trackExposure = true,
): UseWinSmsPreviewEditFlagResult => {
  const { ready, on } = useFlagOn(WIN_SMS_PREVIEW_EDIT_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
