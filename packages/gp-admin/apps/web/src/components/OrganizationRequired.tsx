'use client'

import { useAuthorization } from '@/lib/hooks/useAuthorization'
import { ReactNode } from 'react'
import { AuthCallout } from './AuthCallout'

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
  const { hasActiveOrganization, isSignedIn } = useAuthorization()

  if (!isSignedIn) {
    return <AuthCallout message="Please sign in to continue." centered />
  }

  if (!hasActiveOrganization) {
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
