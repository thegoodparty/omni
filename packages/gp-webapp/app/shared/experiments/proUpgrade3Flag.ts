import { useFlagOn } from './FeatureFlagsProvider'

export const PRO_UPGRADE3_FLAG_KEY = 'pro-upgrade3'

interface UseProUpgrade3FlagResult {
  ready: boolean
  enabled: boolean
}

export const useProUpgrade3Flag = (): UseProUpgrade3FlagResult => {
  const { ready, on } = useFlagOn(PRO_UPGRADE3_FLAG_KEY)
  return { ready, enabled: on }
}

// The pro-upgrade3 cohort's entry into the new Pro-upgrade wizard.
export const PRO_UPGRADE_ENTRY_PATH = '/dashboard/pro-upgrade'

interface UseProUpgradeEntryHrefResult {
  ready: boolean
  href: string
}

// Resolves where a "go Pro" CTA should point. The pro-upgrade3 cohort enters
// the new wizard; everyone else keeps the caller's legacy destination
// (`offCohortHref`). Until the flag resolves we route to the new wizard: it
// self-corrects an off-cohort user (the wizard redirects them back to
// pro-sign-up), but nothing downstream pulls a cohort user out of the legacy
// flow, so the new path is the safe default while `ready` is false.
export const useProUpgradeEntryHref = (
  offCohortHref: string,
): UseProUpgradeEntryHrefResult => {
  const { ready, enabled } = useProUpgrade3Flag()
  return {
    ready,
    href: ready && !enabled ? offCohortHref : PRO_UPGRADE_ENTRY_PATH,
  }
}
