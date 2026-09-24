'use client'

import React, { ReactNode, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@styleguide'
import { useFlagOn } from './FeatureFlagsProvider'

interface FeatureFlagGuardProps {
  flagKey: string
  redirectTo?: string
  // Pass false when a route behind the flag is not itself the experiment's
  // treatment surface — the guard would otherwise expose every user who lands
  // on it, including ones who never saw the surface being measured.
  trackExposure?: boolean
  children: ReactNode
}

export default function FeatureFlagGuard({
  flagKey,
  redirectTo = '/dashboard',
  trackExposure = true,
  children,
}: FeatureFlagGuardProps): React.JSX.Element | null {
  const router = useRouter()
  const { ready: flagsReady, on: flagEnabled } = useFlagOn(flagKey, {
    trackExposure,
  })

  useEffect(() => {
    if (flagsReady && !flagEnabled) {
      router.replace(redirectTo)
    }
  }, [flagsReady, flagEnabled, router, redirectTo])

  if (!flagsReady) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!flagEnabled) {
    return null
  }

  return children as React.JSX.Element
}
