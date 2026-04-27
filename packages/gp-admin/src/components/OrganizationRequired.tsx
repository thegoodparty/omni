'use client'

import { ClerkLoaded, ClerkLoading, useAuth } from '@clerk/nextjs'
import { ReactNode, useEffect, useState } from 'react'
import { AuthCallout } from './AuthCallout'
import { LoadingSpinner } from './LoadingSpinner'

const OrganizationRequiredContent = ({
  children,
}: {
  children: ReactNode
}) => {
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

export const OrganizationRequired = ({ children }: { children: ReactNode }) => {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return !mounted ? (
    <LoadingSpinner />
  ) : (
    <>
      <ClerkLoading>
        <LoadingSpinner />
      </ClerkLoading>
      <ClerkLoaded>
        <OrganizationRequiredContent>{children}</OrganizationRequiredContent>
      </ClerkLoaded>
    </>
  )
}
