import { useFlagOn } from './FeatureFlagsProvider'

export const TEAM_ACCOUNTS_FLAG_KEY = 'win-team-accounts'

interface UseTeamAccountsFlagResult {
  ready: boolean
  enabled: boolean
}

// Gate for the team accounts surface (ENG-10816): the /dashboard/team page
// and its account-menu nav item (ENG-11061 moved it out of the primary nav).
// Defaults off (useFlagOn falls back to 'off'), so the page is unreachable
// and the nav item hidden until the flag is on.
//
// Pass trackExposure=false on surfaces that read the flag to decide whether to
// render something (the dashboard nav item) but aren't themselves the
// experiment's treatment — the team page itself is, and tracks by default.
export const useTeamAccountsFlag = (
  trackExposure = true,
): UseTeamAccountsFlagResult => {
  const { ready, on } = useFlagOn(TEAM_ACCOUNTS_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
