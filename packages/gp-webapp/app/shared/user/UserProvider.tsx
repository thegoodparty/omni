'use client'

import { useUser as useClerkUser } from '@clerk/nextjs'
import { createContext, useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { User } from 'helpers/types'
import { apiRoutes } from 'gpApi/routes'
import { clientFetch } from 'gpApi/clientFetch'
import { clientRequest } from 'gpApi/typed-request'
import { noop } from '@shared/utils/noop'

export type UserContextValue = [User | null, (user?: User) => void, boolean]

const CURRENT_USER_QUERY_KEY = 'currentUser'

export const UserContext = createContext<UserContextValue>([null, noop, true])

async function fetchCurrentUser(): Promise<User | null> {
  try {
    const resp = await clientFetch<User>(apiRoutes.user.getUser)
    if (!resp.ok) return null
    return resp.data
  } catch {
    return null
  }
}

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { isSignedIn, isLoaded, user: clerkUser } = useClerkUser()
  const queryClient = useQueryClient()

  const { data: appUser, isLoading: isQueryLoading } = useQuery({
    queryKey: [CURRENT_USER_QUERY_KEY],
    queryFn: fetchCurrentUser,
    enabled: isLoaded && !!isSignedIn,
  })

  const updateUser = useCallback(
    (user?: User) => {
      if (user) {
        queryClient.setQueryData([CURRENT_USER_QUERY_KEY], user)
      } else {
        queryClient.invalidateQueries({
          queryKey: [CURRENT_USER_QUERY_KEY],
        })
      }
    },
    [queryClient],
  )

  // gp-api only accepts an email change from Clerk, after Clerk verified it.
  // When the user changes it in Clerk's profile modal, ask gp-api to copy it.
  const primaryEmail = clerkUser?.primaryEmailAddress
  const verifiedClerkEmail =
    primaryEmail?.verification?.status === 'verified'
      ? primaryEmail.emailAddress.trim().toLowerCase()
      : undefined
  const syncedEmailKey = useRef<string | null>(null)
  useEffect(() => {
    if (!appUser || !verifiedClerkEmail) return
    if (verifiedClerkEmail === appUser.email.toLowerCase()) return
    const key = `${appUser.id}:${verifiedClerkEmail}`
    if (syncedEmailKey.current === key) return
    syncedEmailKey.current = key
    clientRequest(
      'POST /v1/users/me/sync-email',
      {},
      { ignoreResponseError: true },
    )
      .then((res) => {
        if (res.ok) queryClient.setQueryData([CURRENT_USER_QUERY_KEY], res.data)
      })
      .catch(noop)
  }, [appUser, verifiedClerkEmail, queryClient])

  const isUserLoading = !isLoaded || (!!isSignedIn && isQueryLoading)

  const value: User | null = isLoaded && !isSignedIn ? null : (appUser ?? null)

  // Without memoization this tuple is a new reference on every render, forcing
  // every UserContext consumer (used across the whole authed app) to re-render
  // even when the underlying user/loading state is unchanged.
  const contextValue = useMemo<UserContextValue>(
    () => [value, updateUser, isUserLoading],
    [value, updateUser, isUserLoading],
  )

  return (
    <UserContext.Provider value={contextValue}>{children}</UserContext.Provider>
  )
}
