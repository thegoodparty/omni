'use server'

import { revalidatePath } from 'next/cache'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { gpAction } from '@/shared/util/gpClient.util'
import { PERMISSIONS } from '@/lib/permissions'
import type { UpdateUserInput, User } from '@goodparty_org/sdk'
import {
  SearchUsersParams,
  SearchUsersResult,
  SEARCH_PARAMS,
  DEFAULT_PER_PAGE,
} from './types'

export const searchUsers = async (
  params: SearchUsersParams
): Promise<SearchUsersResult> =>
  gpAction(async (client) => {
    const page = params[SEARCH_PARAMS.PAGE] ?? 1
    const perPage = params[SEARCH_PARAMS.PER_PAGE] ?? DEFAULT_PER_PAGE
    const offset = (page - 1) * perPage

    const result = await client.users.list({
      limit: perPage,
      offset,
      firstName: params[SEARCH_PARAMS.FIRST_NAME],
      lastName: params[SEARCH_PARAMS.LAST_NAME],
      email: params[SEARCH_PARAMS.EMAIL],
    })

    return {
      data: result.data ?? [],
      meta: result.meta,
    }
  })

export const updateUser = async (
  id: number,
  input: UpdateUserInput
): Promise<User> =>
  gpAction(async (client) => {
    const user = await client.users.update(id, input)
    revalidatePath(`/dashboard/users/${id}`, 'layout')
    return user
  })

export const createImpersonationToken = async (
  targetUserEmail: string
): Promise<{ token: string }> => {
  const { userId, has } = await auth()

  if (!userId) throw new Error('Not authenticated')
  if (!has({ permission: PERMISSIONS.IMPERSONATE_USERS })) {
    throw new Error('Missing impersonate permission')
  }

  const client = await clerkClient()

  const { data: clerkUsers } = await client.users.getUserList({
    emailAddress: [targetUserEmail],
    limit: 1,
  })

  const targetClerkUser = clerkUsers[0]
  if (!targetClerkUser) {
    throw new Error('User not found in Clerk')
  }

  const actorToken = await client.actorTokens.create({
    userId: targetClerkUser.id,
    actor: { sub: userId },
    expiresInSeconds: 3600,
  })

  if (!actorToken.token) {
    throw new Error('Failed to create impersonation token')
  }

  return { token: actorToken.token }
}
