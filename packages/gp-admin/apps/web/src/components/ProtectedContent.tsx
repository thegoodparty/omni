'use client'

import { ClerkLoaded, ClerkLoading, useAuth } from '@clerk/nextjs'
import { Permission, Role } from '@/lib/permissions'
import { ReactNode } from 'react'
import { AuthCallout } from './AuthCallout'
import { Flex, Spinner } from '@radix-ui/themes'

interface ProtectedContentProps {
  children: ReactNode
  requiredPermission?: Permission
  requiredRole?: Role
  fallback?: ReactNode
  hideWhenUnauthorized?: boolean
}

function ProtectedContentLoaded({
  children,
  requiredPermission,
  requiredRole,
  fallback,
  hideWhenUnauthorized = false,
}: ProtectedContentProps) {
  const { has, orgId, isSignedIn } = useAuth()

  if (!isSignedIn) {
    if (hideWhenUnauthorized) return null
    return (
      fallback ?? (
        <AuthCallout message="You must be signed in to view this content." />
      )
    )
  }

  if (!orgId) {
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

  if (requiredPermission && !has?.({ permission: requiredPermission })) {
    if (hideWhenUnauthorized) return null
    return (
      fallback ?? (
        <AuthCallout message="You don't have permission to view this content." />
      )
    )
  }

  if (requiredRole && !has?.({ role: requiredRole })) {
    if (hideWhenUnauthorized) return null
    return (
      fallback ?? (
        <AuthCallout message="You don't have the required role to view this content." />
      )
    )
  }

  return children
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
  return (
    <>
      <ClerkLoading>
        {hideWhenUnauthorized ? null : (
          <Flex align="center" justify="center" p="4">
            <Spinner size="2" />
          </Flex>
        )}
      </ClerkLoading>
      <ClerkLoaded>
        <ProtectedContentLoaded
          requiredPermission={requiredPermission}
          requiredRole={requiredRole}
          fallback={fallback}
          hideWhenUnauthorized={hideWhenUnauthorized}
        >
          {children}
        </ProtectedContentLoaded>
      </ClerkLoaded>
    </>
  )
}
