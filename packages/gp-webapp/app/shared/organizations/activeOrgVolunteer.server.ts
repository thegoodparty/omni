import { cookies } from 'next/headers'
import type { Organization } from 'gpApi/api-endpoints'
import { getCurrentUserOrganizations } from 'helpers/getCurrentUserOrganizations'
import { getFlagVariants } from '@shared/experiments/getFlagVariants'
import { TEAM_ACCOUNTS_FLAG_KEY } from '@shared/experiments/teamAccountsFlag'
import { ORG_SLUG_COOKIE } from './constants'

// Mirrors useSelectedOrgSlug's pickSlug: the cookie's org if it's still one
// of the user's, else the first org — the server-side equivalent so a
// redirect decision agrees with whichever org the client-side picker lands
// on.
const resolveActiveOrg = (
  organizations: Organization[],
  activeSlug: string | undefined,
): Organization | undefined =>
  (activeSlug && organizations.find((o) => o.slug === activeSlug)) ||
  organizations[0]

/**
 * Whether the signed-in user's ACTIVE org (not any org they hold) is one
 * where they're a volunteer — gated on win-team-accounts (ENG-11052). Real
 * volunteer memberships aren't creatable yet, but the flag check keeps every
 * caller byte-identical to today's routing even if one somehow existed.
 *
 * Shared by `candidateAccess.ts` (the /dashboard/* → /volunteer bounce and
 * the post-auth redirect) and `app/volunteer/layout.tsx` (the shell's own
 * gate), so the three can't drift on what "active org" or "flag on" means.
 */
export const isActiveOrgVolunteer = async (): Promise<boolean> => {
  const [organizations, flagVariants, cookieStore] = await Promise.all([
    getCurrentUserOrganizations(),
    getFlagVariants(),
    cookies(),
  ])
  if (flagVariants?.[TEAM_ACCOUNTS_FLAG_KEY]?.value !== 'on') {
    return false
  }
  const activeOrg = resolveActiveOrg(
    organizations,
    cookieStore.get(ORG_SLUG_COOKIE)?.value,
  )
  return activeOrg?.role === 'volunteer'
}
