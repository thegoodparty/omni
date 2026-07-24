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

export const isTestUser = (params: { email: string }) =>
  params.email.endsWith('@test.goodparty.org')

// Staff walk product flows in prod with @goodparty.org accounts (isTestUser
// only covers the seeded @test.goodparty.org domain) — both domains count as
// internal.
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
