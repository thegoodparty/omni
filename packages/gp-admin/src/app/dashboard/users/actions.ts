'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { createClerkClient } from '@clerk/backend'
import { gpAction } from '@/shared/util/gpClient.util'
import {
  resolveEnvironment,
  getEnvironmentConfig,
} from '@/shared/util/gpEnvironment'
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
  targetUserId: number
): Promise<{ token: string }> => {
  const { userId: adminClerkId, orgId, has } = await auth()

  if (!adminClerkId) throw new Error('Not authenticated')
  if (!orgId) throw new Error('No active organization')
  if (!has({ permission: PERMISSIONS.IMPERSONATE_USERS })) {
    throw new Error('Missing impersonate permission')
  }

  const environment = resolveEnvironment(orgId)
  const { gpApiRootUrl, m2mSecret } = getEnvironmentConfig(environment)

  // m2mSecret is a Clerk machine secret key — use it to create a proper
  // mt_-prefixed M2M token, same as the SDK does internally
  const clerkClient = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
  })
  const { token } = await clerkClient.m2m.createToken({
    machineSecretKey: m2mSecret,
  })

  const response = await fetch(
    `${gpApiRootUrl}/admin/users/impersonate/${targetUserId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ actorClerkId: adminClerkId }),
    }
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Failed to create impersonation token: ${response.status} ${text}`
    )
  }

  return response.json()
}
