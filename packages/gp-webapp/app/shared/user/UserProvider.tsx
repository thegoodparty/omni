'use client'

import { useUser as useClerkUser } from '@clerk/nextjs'
import { createContext, useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { User } from 'helpers/types'
import { apiRoutes } from 'gpApi/routes'
import { clientFetch } from 'gpApi/clientFetch'
import { clientRequest } from 'gpApi/typed-request'
import { APIEndpoints } from 'gpApi/api-endpoints'
import { noop } from '@shared/utils/noop'
import { useIsImpersonating } from '@shared/hooks/useIsImpersonating'

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

type NamePatch = APIEndpoints['PUT /v1/users/me']['Request']

// gp-api's CreateUserInputSchema rejects shorter names, which would 400 the
// whole update.
const MIN_NAME_LENGTH = 2

// Mirrors gp-api's normalizePersonName, which title-cases an all-lowercase name
// on write. Comparing un-normalized would re-send the same name on every load.
const normalizeName = (value: string): string =>
  value === value.toLowerCase()
    ? value.replace(
        /(^|[^\p{L}])(\p{L})/gu,
        (_match, boundary: string, letter: string) =>
          `${boundary}${letter.toUpperCase()}`,
      )
    : value

const changedName = (
  clerkValue: string | null | undefined,
  appValue: string | null | undefined,
): string | null => {
  const next = normalizeName(clerkValue?.trim() ?? '')
  if (next.length < MIN_NAME_LENGTH || next === appValue) return null
  return next
}

// Users edit their name in Clerk (Account > Edit details), but gp-api copies it
// only when the user row is first provisioned, so later edits never reach the
// row that the dashboard and the public /people profile slug are built from.
const nameDrift = (
  clerkUser: { firstName: string | null; lastName: string | null },
  appUser: User,
): NamePatch | null => {
  const firstName = changedName(clerkUser.firstName, appUser.firstName)
  const lastName = changedName(clerkUser.lastName, appUser.lastName)
  if (!firstName && !lastName) return null
  const patch: NamePatch = {
    name: [firstName ?? appUser.firstName, lastName ?? appUser.lastName]
      .filter(Boolean)
      .join(' '),
  }
  if (firstName) patch.firstName = firstName
  if (lastName) patch.lastName = lastName
  return patch
}

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { isSignedIn, isLoaded, user: clerkUser } = useClerkUser()
  const isImpersonating = useIsImpersonating()
  const queryClient = useQueryClient()
  const attemptedNameSync = useRef<string | null>(null)

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

  const hasClerkUser = !!clerkUser
  const clerkFirstName = clerkUser?.firstName ?? null
  const clerkLastName = clerkUser?.lastName ?? null

  useEffect(() => {
    // An impersonating admin is acting as the user, not editing their profile.
    if (!appUser || !hasClerkUser || isImpersonating) return
    const patch = nameDrift(
      { firstName: clerkFirstName, lastName: clerkLastName },
      appUser,
    )
    if (!patch) return
    // One attempt per distinct change, so a rejected write is not retried on
    // every render.
    const attempt = `${appUser.id}:${JSON.stringify(patch)}`
    if (attemptedNameSync.current === attempt) return
    attemptedNameSync.current = attempt
    clientRequest('PUT /v1/users/me', patch)
      .then(({ data }) => {
        queryClient.setQueryData([CURRENT_USER_QUERY_KEY], data)
      })
      .catch((error: unknown) => {
        console.error('Failed to sync name from Clerk', error)
      })
  }, [
    appUser,
    hasClerkUser,
    clerkFirstName,
    clerkLastName,
    isImpersonating,
    queryClient,
  ])

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
