'use client'

import { ClerkLoaded, ClerkLoading, useAuth } from '@clerk/nextjs'
import { ReactNode } from 'react'
import { AuthCallout } from './AuthCallout'
import { LoadingSpinner } from './LoadingSpinner'

function OrganizationRequiredContent({ children }: { children: ReactNode }) {
  const { orgId, isSignedIn } = useAuth()

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

  return children
}

export function OrganizationRequired({ children }: { children: ReactNode }) {
  return (
    <>
      <ClerkLoading>
        <LoadingSpinner showText={false} />
      </ClerkLoading>
      <ClerkLoaded>
        <OrganizationRequiredContent>{children}</OrganizationRequiredContent>
      </ClerkLoaded>
    </>
  )
}
