'use client'

import { useUser } from '@shared/hooks/useUser'
import {
  persistUtmsOnce,
  getPersistedUtms,
  getPersistedClids,
  extractClids,
  setUserEmail,
  setActorUserId,
  setActorRole,
} from 'helpers/analyticsHelper'
import { useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { identifyUser } from '@shared/utils/analytics'
import { buildUserTraits } from 'helpers/buildUserTraits'
import { User } from 'helpers/types'
import { useOrganizationRole } from '@shared/organization-picker'

const identify = async (
  user: User | null,
  searchParams: ReturnType<typeof useSearchParams>,
) => {
  persistUtmsOnce()
  setUserEmail(user?.email)

  // fbclid_first/_last are intentional here: first/last-touch attribution, same
  // shape as the persisted UTMs above. Registration additionally emits a single
  // canonical `fbclid` (see trackRegistrationCompleted) for Meta CAPI matching.
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
  const organizationRole = useOrganizationRole()

  useEffect(() => {
    identify(user, searchParams)
  }, [user, searchParams])

  // Kept as its own effect (not folded into identify()) because the actor
  // role changes on an org switch alone, without user identity changing —
  // re-running the UTM/CLID persistence above on every org switch would be
  // wasted work for a value that doesn't depend on it.
  useEffect(() => {
    setActorUserId(user?.id)
    setActorRole(organizationRole ?? null)
  }, [user?.id, organizationRole])

  return null
}

export default SegmentIdentify
