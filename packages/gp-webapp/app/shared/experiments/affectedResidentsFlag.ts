import { useFlagOn } from './FeatureFlagsProvider'

export const AFFECTED_RESIDENTS_FLAG_KEY = 'serve-affected-residents'

interface UseAffectedResidentsFlagResult {
  ready: boolean
  enabled: boolean
}

// Gate for the per-issue affected-residents list and map on the Serve
// Community Issues pages. Defaults off (useFlagOn falls back to 'off'), so the
// next-step card on an issue and the list page itself stay hidden until the
// flag is targeted at an officeholder in Amplitude.
//
// The flag only gates the UX. The list is individual-level L2 data, so gp-api
// resolves the issue with `where { id, organizationSlug }` before it reads the
// bucket and returns null for anyone else — turning the flag on for an office
// with no list shows nothing, and turning it on for the wrong office shows
// nothing either.
//
// Pass trackExposure=false on surfaces that read the flag to decide whether to
// render an entry point (the next-step card on the issue) but aren't themselves
// the treatment — the list page is, and tracks by default.
export const useAffectedResidentsFlag = (
  trackExposure = true,
): UseAffectedResidentsFlagResult => {
  const { ready, on } = useFlagOn(AFFECTED_RESIDENTS_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
