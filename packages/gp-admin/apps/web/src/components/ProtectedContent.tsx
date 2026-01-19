'use client'

import { useAuthorization } from '@/lib/hooks/useAuthorization'
import { Permission, Role } from '@/lib/permissions'
import { ReactNode } from 'react'
import { AuthCallout } from './AuthCallout'
import { Flex, Spinner } from '@radix-ui/themes'

interface ProtectedContentProps {
  children: ReactNode
  /** Permission required to view this content */
  requiredPermission?: Permission
  /** Role required to view this content */
  requiredRole?: Role
  /** Custom fallback component when unauthorized */
  fallback?: ReactNode
  /** If true, shows nothing instead of error message when unauthorized */
  hideWhenUnauthorized?: boolean
}

/**
 * Component that conditionally renders children based on user's role/permission
 *
 * Usage:
 * ```tsx
 * <ProtectedContent requiredPermission={PERMISSIONS.WRITE_USERS}>
 *   <EditButton />
 * </ProtectedContent>
 *
 * <ProtectedContent requiredRole={ROLES.ADMIN} hideWhenUnauthorized>
 *   <AdminPanel />
 * </ProtectedContent>
 * ```
 */
export function ProtectedContent({
  children,
  requiredPermission,
  requiredRole,
  fallback,
  hideWhenUnauthorized = false,
}: ProtectedContentProps) {
  const {
    hasPermission,
    hasRole,
    hasActiveOrganization,
    isSignedIn,
    isLoaded,
  } = useAuthorization()

  if (!isLoaded) {
    if (hideWhenUnauthorized) return null
    return (
      <Flex align="center" justify="center" p="4">
        <Spinner size="2" />
      </Flex>
    )
  }

  if (!isSignedIn) {
    if (hideWhenUnauthorized) return null
    return (
      fallback ?? (
        <AuthCallout message="You must be signed in to view this content." />
      )
    )
  }

  if (!hasActiveOrganization) {
    if (hideWhenUnauthorized) return null
    return (
      fallback ?? (
        <AuthCallout
          message="Please select an organization to continue."
          color="amber"
        />
      )
    )
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    if (hideWhenUnauthorized) return null
    return (
      fallback ?? (
        <AuthCallout message="You don't have permission to view this content." />
      )
    )
  }

  if (requiredRole && !hasRole(requiredRole)) {
    if (hideWhenUnauthorized) return null
    return (
      fallback ?? (
        <AuthCallout message="You don't have the required role to view this content." />
      )
    )
  }

  return <>{children}</>
}
