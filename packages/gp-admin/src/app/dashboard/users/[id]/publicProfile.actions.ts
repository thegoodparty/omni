'use server'

import { auth, currentUser } from '@clerk/nextjs/server'
import { PERMISSIONS, type Permission } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import { extractApiErrorMessage } from '@/lib/utils/sdkError'
import type { PersonLookupResult, PersonProfileLink } from '@/shared/gpApi'

export type PublicProfileActionResult<T> =
  | { data: T; error: null }
  | { data: null; error: string }

async function hasPermission(permission: Permission): Promise<boolean> {
  const { has } = await auth()
  // Clerk hands back `has: null` for an unauthenticated session.
  return Boolean(has?.({ permission }))
}

// Failures are returned, not thrown: Next redacts a thrown server-action
// error's message in prod, and gp-api's 4xx messages here (person already
// linked to someone else, record merged away) are what the staff member has
// to read to know what to do next.
const toResult = async <T>(
  run: () => Promise<T>,
  fallback: string
): Promise<PublicProfileActionResult<T>> => {
  try {
    return { data: await run(), error: null }
  } catch (error) {
    return { data: null, error: extractApiErrorMessage(error, fallback) }
  }
}

export const getPublicProfileLink = async (
  userId: number
): Promise<PublicProfileActionResult<PersonProfileLink>> => {
  if (!(await hasPermission(PERMISSIONS.READ_USERS))) {
    return { data: null, error: 'Missing read_users permission' }
  }
  return toResult(
    () => gpAction((client) => client.personProfiles.getLink(userId)),
    "Couldn't load the public profile link"
  )
}

export const findPublicProfile = async (
  query: string
): Promise<PublicProfileActionResult<PersonLookupResult>> => {
  if (!(await hasPermission(PERMISSIONS.WRITE_USERS))) {
    return { data: null, error: 'Missing write_users permission' }
  }
  return toResult(
    () => gpAction((client) => client.personProfiles.lookupPerson(query)),
    'No profile matches that link. Check it and try again.'
  )
}

export const linkPublicProfile = async (
  userId: number,
  personId: string
): Promise<PublicProfileActionResult<PersonProfileLink>> => {
  if (!(await hasPermission(PERMISSIONS.WRITE_USERS))) {
    return { data: null, error: 'Missing write_users permission' }
  }
  // gp-admin reaches gp-api with a shared M2M token, so this is the only point
  // where the operator is known. gp-api logs it against the link.
  const user = await currentUser()
  const linkedBy = user?.primaryEmailAddress?.emailAddress
  if (!linkedBy) {
    return { data: null, error: 'Could not determine which operator is acting' }
  }
  return toResult(
    () =>
      gpAction((client) =>
        client.personProfiles.linkOwner({ userId, personId, linkedBy })
      ),
    "Couldn't link the profile"
  )
}
