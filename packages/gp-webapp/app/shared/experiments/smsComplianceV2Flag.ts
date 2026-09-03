import { useFlagOn } from './FeatureFlagsProvider'

export const SMS_COMPLIANCE_V2_FLAG_KEY = 'voter-outreach-sms-compliance'

interface UseSmsComplianceV2FlagResult {
  ready: boolean
  enabled: boolean
}

// The 2026-09-02 SMS compliance launch switch. On: the composer appends the
// "Paid for by <committee>." line, the five-rule standards check blocks
// scheduling, candidate editing disappears (only cancel remains), and the
// details sheet shows the Statistics card. Off is exactly the pre-launch
// product. gp-api mirrors it with SMS_COMPLIANCE_V2_ENABLED, which owns the
// server-side enforcement — flip both together.
export const useSmsComplianceV2Flag = (
  trackExposure = true,
): UseSmsComplianceV2FlagResult => {
  const { ready, on } = useFlagOn(SMS_COMPLIANCE_V2_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
