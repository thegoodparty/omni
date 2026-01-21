'use client'

import { useAuth, useOrganization } from '@clerk/nextjs'
import { ReactNode } from 'react'
import { AuthCallout } from './AuthCallout'
import { Flex, Spinner } from '@radix-ui/themes'

/**
 * Component that requires an active organization to render children
 *
 * Usage:
 * ```tsx
 * <OrganizationRequired>
 *   <DashboardContent />
 * </OrganizationRequired>
 * ```
 */
export function OrganizationRequired({ children }: { children: ReactNode }) {
  const { orgId, isSignedIn, isLoaded } = useAuth()
  const { isLoaded: isOrgLoaded } = useOrganization()

  if (!isLoaded || !isOrgLoaded) {
    return (
      <Flex align="center" justify="center" p="8">
        <Spinner size="3" />
      </Flex>
    )
  }

  if (!isSignedIn) {
    return <AuthCallout message="Please sign in to continue." centered />
  }

  if (!orgId) {
    return (
      <AuthCallout
        message="Please select an organization from the header to continue."
        color="amber"
        centered
      />
    )
  }

  return <>{children}</>
}
