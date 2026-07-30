'use client'

import { useUser } from '@shared/hooks/useUser'
import {
  persistUtmsOnce,
  getPersistedUtms,
  getPersistedClids,
  extractClids,
  setUserEmail,
} from 'helpers/analyticsHelper'
import { useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { identifyUser } from '@shared/utils/analytics'
import { buildUserTraits } from 'helpers/buildUserTraits'
import { User } from 'helpers/types'

const identify = async (
  user: User | null,
  searchParams: ReturnType<typeof useSearchParams>,
) => {
  persistUtmsOnce()
  setUserEmail(user?.email)

  const persistedClids = Object.fromEntries(
    Object.entries(getPersistedClids()).filter(([, value]) => value !== null),
  ) as Record<string, string>

  const traits = {
    ...getPersistedUtms(),
    ...persistedClids,
    ...(searchParams ? extractClids(searchParams) : {}),
  }

  if (user?.id) {
    const userTraits = {
      ...buildUserTraits(user),
      ...traits,
    }
    await identifyUser(user.id, userTraits)
  } else {
    await identifyUser(null, traits)
  }
}

const SegmentIdentify = (): null => {
  const [user] = useUser()
  const searchParams = useSearchParams()

  useEffect(() => {
    identify(user, searchParams)
  }, [user, searchParams])

  return null
}

export default SegmentIdentify
