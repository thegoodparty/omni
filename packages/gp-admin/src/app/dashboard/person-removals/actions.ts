'use server'

import { auth, currentUser } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import type {
  PersonLookupResult,
  PersonProfileRemoval,
} from '@goodparty_org/sdk'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'

const PERSON_REMOVALS_PATH = '/dashboard/person-removals'

async function requirePermission(): Promise<void> {
  const { has } = await auth()
  // Clerk hands back `has: null` for an unauthenticated session, so calling it
  // unguarded surfaces a TypeError instead of the permission failure.
  if (!has?.({ permission: PERMISSIONS.MANAGE_PERSON_REMOVALS })) {
    throw new Error('Missing manage_person_removals permission')
  }
}

/**
 * The operator's own email, which every write below sends to gp-api as the
 * actor. gp-admin authenticates to gp-api with a shared M2M token, so this is
 * the *only* point in the chain where the human is known — if it were omitted
 * the takedown would be recorded against nobody, which is the gap this feature
 * exists to close. Fail rather than fall back to a placeholder.
 */
async function requireActorEmail(): Promise<string> {
  await requirePermission()
  const user = await currentUser()
  const email = user?.primaryEmailAddress?.emailAddress
  if (!email) {
    throw new Error('Could not determine which operator is acting')
  }
  return email
}

export const listPersonRemovals = async (
  includeCleared: boolean
): Promise<PersonProfileRemoval[]> => {
  await requirePermission()
  return gpAction((client) =>
    client.personProfiles.listRemovals({ includeCleared })
  )
}

/**
 * Resolves the public URL a privacy request names into a personId plus the
 * subject's name, so the operator confirms who they are about to remove. A
 * mis-keyed id takes down the wrong person's page with nothing to notice.
 */
export const lookupPerson = async (
  query: string
): Promise<PersonLookupResult> => {
  await requirePermission()
  return gpAction((client) => client.personProfiles.lookupPerson(query))
}

export const removePersonProfile = async (
  personId: string,
  note: string
): Promise<void> => {
  const appliedBy = await requireActorEmail()
  await gpAction((client) =>
    client.personProfiles.setRemoval({
      personId,
      appliedBy,
      note: note.trim() || null,
    })
  )
  revalidatePath(PERSON_REMOVALS_PATH)
}

export const restorePersonProfile = async (personId: string): Promise<void> => {
  const clearedBy = await requireActorEmail()
  await gpAction((client) =>
    client.personProfiles.clearRemoval({ personId, clearedBy })
  )
  revalidatePath(PERSON_REMOVALS_PATH)
}
