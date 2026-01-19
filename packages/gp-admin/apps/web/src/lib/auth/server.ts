import { auth, clerkClient } from '@clerk/nextjs/server'
import {
  PERMISSIONS,
  ROLES,
  type Permission,
  type Role,
} from '@/lib/permissions'

type AuthenticatedContext = {
  isAuthenticated: true
  userId: string
  orgId: string | null
  orgRole: string | null | undefined
  organization: Awaited<
    ReturnType<
      Awaited<
        ReturnType<typeof clerkClient>
      >['organizations']['getOrganization']
    >
  > | null
  hasPermission: (permission: Permission) => boolean
  hasRole: (role: Role) => boolean
  isAdmin: boolean
  isSales: boolean
  isReadOnly: boolean
  canReadUsers: boolean
  canWriteUsers: boolean
  canReadCampaigns: boolean
  canWriteCampaigns: boolean
  canManageSettings: boolean
  canInviteMembers: boolean
}

type UnauthenticatedContext = {
  isAuthenticated: false
}

export type AuthContext = AuthenticatedContext | UnauthenticatedContext

/**
 * Server-side authorization utility for checking roles and permissions
 *
 * Usage in Server Components:
 * ```tsx
 * const authContext = await getAuthContext()
 *
 * if (!authContext.isAuthenticated) {
 *   redirect('/auth/sign-in')
 * }
 *
 * if (!authContext.canWriteUsers) {
 *   return <p>Access denied</p>
 * }
 * ```
 *
 * Usage in Server Actions:
 * ```tsx
 * 'use server'
 * export async function updateUser(formData: FormData) {
 *   const authContext = await getAuthContext()
 *   if (!authContext.isAuthenticated || !authContext.canWriteUsers) {
 *     throw new Error('Unauthorized')
 *   }
 *   // ... perform action
 * }
 * ```
 */
export async function getAuthContext(): Promise<AuthContext> {
  const { userId, orgId, orgRole, has } = await auth()

  if (!userId) {
    return { isAuthenticated: false }
  }

  const hasPermission = (permission: Permission): boolean => {
    return has?.({ permission }) ?? false
  }

  const hasRole = (role: Role): boolean => {
    return has?.({ role }) ?? false
  }

  let organization = null
  if (orgId) {
    try {
      const client = await clerkClient()
      organization = await client.organizations.getOrganization({
        organizationId: orgId,
      })
    } catch {
      // Organization fetch failed, continue without org details
      organization = null
    }
  }

  return {
    isAuthenticated: true,
    userId,
    orgId: orgId ?? null,
    orgRole: orgRole ?? null,
    organization,
    hasPermission,
    hasRole,
    isAdmin: hasRole(ROLES.ADMIN),
    isSales: hasRole(ROLES.SALES),
    isReadOnly: hasRole(ROLES.READ_ONLY),
    canReadUsers: hasPermission(PERMISSIONS.READ_USERS),
    canWriteUsers: hasPermission(PERMISSIONS.WRITE_USERS),
    canReadCampaigns: hasPermission(PERMISSIONS.READ_CAMPAIGNS),
    canWriteCampaigns: hasPermission(PERMISSIONS.WRITE_CAMPAIGNS),
    canManageSettings: hasPermission(PERMISSIONS.MANAGE_SETTINGS),
    canInviteMembers: hasPermission(PERMISSIONS.INVITE_MEMBERS),
  }
}

/**
 * Quick check if user has a specific permission (server-side)
 *
 * Usage:
 * ```tsx
 * if (!(await hasServerPermission(PERMISSIONS.WRITE_USERS))) {
 *   throw new Error('Unauthorized')
 * }
 * ```
 */
export async function hasServerPermission(
  permission: Permission
): Promise<boolean> {
  const { has } = await auth()
  return has?.({ permission }) ?? false
}

/**
 * Quick check if user has a specific role (server-side)
 *
 * Usage:
 * ```tsx
 * if (!(await hasServerRole(ROLES.ADMIN))) {
 *   redirect('/dashboard')
 * }
 * ```
 */
export async function hasServerRole(role: Role): Promise<boolean> {
  const { has } = await auth()
  return has?.({ role }) ?? false
}
