import { randomUUID } from 'crypto'
import { User, UserRole } from '../../generated/prisma'

export const getUserFullName = (user: User) =>
  !user
    ? ''
    : user.firstName
      ? `${user.firstName} ${user.lastName || ''}`.trim()
      : user.name
        ? user.name
        : ''

/** Helper to check a User's roles against one or many roles */
export function userHasRole(user: User, roleOrRoles: UserRole | UserRole[]) {
  const userRoles = user.roles

  if (!userRoles || userRoles.length === 0) return false

  if (Array.isArray(roleOrRoles)) {
    return roleOrRoles.some((element) => userRoles.includes(element))
  }

  return userRoles.includes(roleOrRoles)
}

export function isAdmin(user: User) {
  return userHasRole(user, UserRole.admin)
}

export const TEST_USER_DOMAIN = '@test.goodparty.org'

// QA fixture users (src/testFixtures) live on the real @goodparty.org domain
// so Amplitude flags targeting internal traffic apply to them on dev; the
// qa-<uuid> local part is what marks them as test users — no staff email
// takes this shape, so real @goodparty.org accounts stay non-test.
export const FIXTURE_USER_EMAIL_PREFIX = 'qa-'
export const FIXTURE_USER_EMAIL_DOMAIN = '@goodparty.org'
export const FIXTURE_USER_EMAIL_PATTERN =
  /^qa-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}@goodparty\.org$/i

export const newFixtureUserEmail = () =>
  `${FIXTURE_USER_EMAIL_PREFIX}${randomUUID()}${FIXTURE_USER_EMAIL_DOMAIN}`

export const isTestUser = (params: { email: string }) =>
  params.email.endsWith(TEST_USER_DOMAIN) ||
  FIXTURE_USER_EMAIL_PATTERN.test(params.email)

// Distinct from isTestUser on purpose: isTestUser gates behavior for
// synthetic accounts only (stubbed vendor calls, skipped dispatches) and must
// NOT cover staff @goodparty.org accounts — staff dogfood real flows in prod.
// isInternalUser is for staff-facing affordances and reporting exclusions,
// where both domains count as internal.
export const INTERNAL_EMAIL_SUFFIXES = ['@goodparty.org', '@test.goodparty.org']

export const isInternalUser = (params: { email: string }) =>
  INTERNAL_EMAIL_SUFFIXES.some((suffix) =>
    params.email.toLowerCase().endsWith(suffix),
  )

export const isTestCampaign = (
  campaign: { user?: { email?: string | null } | null } | null,
): boolean => {
  const email = campaign?.user?.email
  return !!email && isTestUser({ email })
}
