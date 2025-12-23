'use client'

import { useEffect, useState } from 'react'

/**
 * Hook to detect if the app is running in E2E testing mode.
 *
 * E2E testing mode requires both:
 * 1. The NEXT_PUBLIC_E2E_TESTING env flag set to 'true'
 * 2. The __e2e_bypass cookie to be present
 *
 * This is used to bypass Clerk authentication during Playwright tests.
 */
export function useE2ETesting(): boolean {
  const [isE2ETesting, setIsE2ETesting] = useState(false)

  useEffect(() => {
    const hasEnvFlag = process.env.NEXT_PUBLIC_E2E_TESTING === 'true'
    const hasCookie = document.cookie.includes('__e2e_bypass=true')
    setIsE2ETesting(hasEnvFlag && hasCookie)
  }, [])

  return isE2ETesting
}
