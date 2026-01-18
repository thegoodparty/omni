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
 * const { isAdmin, canWriteUsers, hasPermission } = useAuthorization()
 *
 * if (canWriteUsers) {
 *   // Show edit button
 * }
 * ```
 */
export function useAuthorization() {
  const { has, orgRole, orgId, isSignedIn } = useAuth()
  const { organization } = useOrganization()

  const hasPermission = (permission: Permission): boolean => {
    if (!isSignedIn || !orgId) return false
    return has?.({ permission }) ?? false
  }

  const hasRole = (role: Role): boolean => {
    if (!isSignedIn || !orgId) return false
    return has?.({ role }) ?? false
  }

  // Role checks
  const isAdmin = hasRole(ROLES.ADMIN)
  const isSales = hasRole(ROLES.SALES)
  const isReadOnly = hasRole(ROLES.READ_ONLY)

  // Permission checks
  const canReadUsers = hasPermission(PERMISSIONS.READ_USERS)
  const canWriteUsers = hasPermission(PERMISSIONS.WRITE_USERS)
  const canReadCampaigns = hasPermission(PERMISSIONS.READ_CAMPAIGNS)
  const canWriteCampaigns = hasPermission(PERMISSIONS.WRITE_CAMPAIGNS)
  const canManageSettings = hasPermission(PERMISSIONS.MANAGE_SETTINGS)
  const canInviteMembers = hasPermission(PERMISSIONS.INVITE_MEMBERS)

  return {
    // Status
    isSignedIn: isSignedIn ?? false,
    hasActiveOrganization: !!orgId,
    organizationId: orgId,
    organizationName: organization?.name,
    organizationSlug: organization?.slug,
    currentRole: orgRole,

    // Role checks
    isAdmin,
    isSales,
    isReadOnly,

    // Permission checks
    canReadUsers,
    canWriteUsers,
    canReadCampaigns,
    canWriteCampaigns,
    canManageSettings,
    canInviteMembers,

    // Generic checks
    hasPermission,
    hasRole,
  }
}
