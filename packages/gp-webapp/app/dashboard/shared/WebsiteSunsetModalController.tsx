'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@shared/hooks/useUser'
import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import type { User } from 'helpers/types'
import { WebsiteSunsetModal } from './WebsiteSunsetModal'

interface WebsiteSunsetModalControllerProps {
  eligible: boolean
}

// Shows the sunset modal once per candidate. Dismissal is persisted to the
// candidate's user metadata (not browser localStorage) so it doesn't leak
// across impersonated candidates sharing one admin browser (ENG-10344).
export function WebsiteSunsetModalController({
  eligible,
}: WebsiteSunsetModalControllerProps): React.JSX.Element | null {
  const [user, setUser, isUserLoading] = useUser()
  const [open, setOpen] = useState(false)
  const dismissed = Boolean(user?.metaData?.websiteSunsetModalDismissed)

  useEffect(() => {
    if (!isUserLoading && eligible && !dismissed) {
      setOpen(true)
    }
  }, [isUserLoading, eligible, dismissed])

  const dismiss = (): void => {
    // Optimistically flip the flag on the cached (enriched) user so a failed
    // PUT can't reopen the modal on client navigation. Spreading the existing
    // user preserves Clerk fields/relations; the PUT below makes it durable.
    if (user) {
      setUser({
        ...user,
        metaData: { ...user.metaData, websiteSunsetModalDismissed: true },
      })
    }
    void persistDismissal()
  }

  const persistDismissal = async (): Promise<void> => {
    try {
      const response = await clientFetch<User>(apiRoutes.user.updateMeta, {
        meta: { websiteSunsetModalDismissed: true },
      })
      // On success refetch GET /users/me so the cache holds the server's
      // enriched record rather than the optimistic patch.
      if (response.ok) {
        setUser()
      }
    } catch (error) {
      console.error('Failed to persist website sunset dismissal', error)
    }
  }

  const handleOpenChange = (next: boolean): void => {
    setOpen(next)
    if (!next && !dismissed) {
      dismiss()
    }
  }

  if (!eligible || dismissed) {
    return null
  }

  return <WebsiteSunsetModal open={open} onOpenChange={handleOpenChange} />
}
