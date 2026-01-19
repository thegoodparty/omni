'use client'

import { useAuth, useOrganization } from '@clerk/nextjs'
import {
  ROLES,
  PERMISSIONS,
  type Permission,
  type Role,
} from '@/lib/permissions'

/**
 * Client-side authorization hook for checking roles and permissions
 *
 * Usage:
 * ```tsx
 * const { isAdmin, canWriteUsers, hasPermission, isLoaded } = useAuthorization()
 *
 * if (!isLoaded) return <Skeleton />
 *
 * if (canWriteUsers) {
 *   // Show edit button
 * }
 * ```
 */
export function useAuthorization() {
  const { has, orgRole, orgId, isSignedIn, isLoaded } = useAuth()
  const { organization, isLoaded: isOrgLoaded } = useOrganization()

  const hasPermission = (permission: Permission): boolean => {
    if (!isSignedIn || !orgId) return false
    return has?.({ permission }) ?? false
  }

  const hasRole = (role: Role): boolean => {
    if (!isSignedIn || !orgId) return false
    return has?.({ role }) ?? false
  }

  const isAdmin = hasRole(ROLES.ADMIN)
  const isSales = hasRole(ROLES.SALES)
  const isReadOnly = hasRole(ROLES.READ_ONLY)

  const canReadUsers = hasPermission(PERMISSIONS.READ_USERS)
  const canWriteUsers = hasPermission(PERMISSIONS.WRITE_USERS)
  const canReadCampaigns = hasPermission(PERMISSIONS.READ_CAMPAIGNS)
  const canWriteCampaigns = hasPermission(PERMISSIONS.WRITE_CAMPAIGNS)
  const canManageSettings = hasPermission(PERMISSIONS.MANAGE_SETTINGS)
  const canInviteMembers = hasPermission(PERMISSIONS.INVITE_MEMBERS)

  return {
    isLoaded: isLoaded && isOrgLoaded,
    isSignedIn: isSignedIn ?? false,
    hasActiveOrganization: !!orgId,
    organizationId: orgId,
    organizationName: organization?.name,
    organizationSlug: organization?.slug,
    currentRole: orgRole,
    isAdmin,
    isSales,
    isReadOnly,
    canReadUsers,
    canWriteUsers,
    canReadCampaigns,
    canWriteCampaigns,
    canManageSettings,
    canInviteMembers,
    hasPermission,
    hasRole,
  }
}
