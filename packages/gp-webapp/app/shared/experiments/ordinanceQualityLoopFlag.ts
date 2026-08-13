import { useFlagOn } from './FeatureFlagsProvider'

// Gates the background quality-improvement loop for ordinance drafts (the
// gp-api SQS loop plus its webapp surfaces). Layered on serve-ordinances:
// flag-off users keep the manual claim-and-poll quality check.
export const ORDINANCE_QUALITY_LOOP_FLAG_KEY = 'serve-ordinance-quality-loop'

interface UseOrdinanceQualityLoopFlagResult {
  ready: boolean
  enabled: boolean
}

// Pass trackExposure=false on surfaces that read the flag but aren't the
// treatment (e.g. the draft-ready chat card), so the read doesn't inflate
// the exposed population.
export const useOrdinanceQualityLoopFlag = (
  trackExposure = true,
): UseOrdinanceQualityLoopFlagResult => {
  const { ready, on } = useFlagOn(ORDINANCE_QUALITY_LOOP_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
