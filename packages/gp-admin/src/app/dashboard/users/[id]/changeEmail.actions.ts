'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import { extractApiErrorMessage } from '@/lib/utils/sdkError'
import type { ChangeUserEmailOutput } from '@/shared/gpApi'

export type ChangeEmailResult =
  | { data: ChangeUserEmailOutput; error: null }
  | { data: null; error: string }

// Returned, not thrown: Next redacts a thrown server-action error in prod,
// and gp-api's 409 names the account that already holds the address, which
// is what staff need to read.
export const changeUserEmail = async (
  userId: number,
  email: string
): Promise<ChangeEmailResult> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.WRITE_USERS })) {
    return { data: null, error: 'Missing write_users permission' }
  }
  try {
    const data = await gpAction((client) =>
      client.users.changeEmail(userId, { email })
    )
    revalidatePath(`/dashboard/users/${userId}`, 'layout')
    return { data, error: null }
  } catch (error) {
    return {
      data: null,
      error: extractApiErrorMessage(error, "Couldn't change the email"),
    }
  }
}
