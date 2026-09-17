'use client'

import React, { ReactNode, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@styleguide'
import { useFlagOn } from './FeatureFlagsProvider'

interface FeatureFlagGuardProps {
  flagKey: string
  redirectTo?: string
  children: ReactNode
}

export default function FeatureFlagGuard({
  flagKey,
  redirectTo = '/dashboard',
  children,
}: FeatureFlagGuardProps): React.JSX.Element | null {
  const router = useRouter()
  const { ready: flagsReady, on: flagEnabled } = useFlagOn(flagKey)

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
