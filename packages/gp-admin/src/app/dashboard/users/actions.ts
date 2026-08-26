'use server'

import { PERMISSIONS } from '@/lib/permissions'
import { extractApiErrorMessage } from '@/lib/utils/sdkError'
import { gpAction } from '@/shared/util/gpClient.util'
import {
  GP_ENVIRONMENT,
  resolveEnvironment,
  type GpEnvironment,
} from '@/shared/util/gpEnvironment'
import { auth, currentUser } from '@clerk/nextjs/server'
import { SdkError, type UpdateUserInput, type User } from '@goodparty_org/sdk'
import { revalidatePath } from 'next/cache'
import {
  DEFAULT_PER_PAGE,
  SEARCH_PARAMS,
  SearchUsersParams,
  SearchUsersResult,
} from './types'

function getWebappUrl(env: GpEnvironment): string {
  const urls: Record<GpEnvironment, string | undefined> = {
    [GP_ENVIRONMENT.DEV]: process.env.NEXT_PUBLIC_GP_DEV_WEBAPP_URL,
    [GP_ENVIRONMENT.PROD]: process.env.NEXT_PUBLIC_GP_WEBAPP_URL,
  }
  const url = urls[env]
  if (!url) throw new Error(`Webapp URL not configured for environment: ${env}`)
  return url
}

export const searchUsers = async (
  params: SearchUsersParams
): Promise<SearchUsersResult> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.READ_USERS })) {
    throw new Error('Missing read_users permission')
  }
  return gpAction(async (client) => {
    const page = params[SEARCH_PARAMS.PAGE] ?? 1
    const perPage = params[SEARCH_PARAMS.PER_PAGE] ?? DEFAULT_PER_PAGE
    const offset = (page - 1) * perPage

    const result = await client.users.list({
      limit: perPage,
      offset,
      firstName: params[SEARCH_PARAMS.FIRST_NAME],
      lastName: params[SEARCH_PARAMS.LAST_NAME],
      email: params[SEARCH_PARAMS.EMAIL],
      ...(params[SEARCH_PARAMS.IS_PRO] !== undefined
        ? { isPro: params[SEARCH_PARAMS.IS_PRO] }
        : {}),
    } as Parameters<(typeof client)['users']['list']>[0])

    const users = result.data ?? []

    return {
      data: users.map((user) => ({ ...user, isPro: false })),
      meta: result.meta,
    }
  })
}

export const getUsersProFlags = async (
  userIds: readonly number[]
): Promise<Record<number, boolean>> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.READ_USERS })) {
    throw new Error('Missing read_users permission')
  }
  return gpAction(async (client) => {
    const entries = await Promise.all(
      userIds.map(async (id): Promise<readonly [number, boolean]> => {
        try {
          const { data: campaigns } = await client.campaigns.list({
            userId: id,
          })
          return [id, campaigns.some((c) => c.isPro === true)] as const
        } catch {
          return [id, false] as const
        }
      })
    )
    return Object.fromEntries(entries)
  })
}

// Returns the failure reason instead of throwing: Next redacts messages of
// errors thrown from server actions in production, so this is the only way
// the browser can show the API's actual validation error.
export const updateUser = async (
  id: number,
  input: UpdateUserInput
): Promise<{ user: User } | { error: string }> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.WRITE_USERS })) {
    throw new Error('Missing write_users permission')
  }
  try {
    return await gpAction(async (client) => {
      const user = await client.users.update(id, input)
      revalidatePath(`/dashboard/users/${id}`, 'layout')
      return { user }
    })
  } catch (error) {
    if (!(error instanceof SdkError)) throw error
    return { error: extractApiErrorMessage(error, 'Failed to save changes') }
  }
}

export const createImpersonationToken = async (targetUserId: number) => {
  const { orgId, has } = await auth()
  const user = await currentUser()

  if (!user || !orgId) throw new Error('Not authenticated')
  if (!has({ permission: PERMISSIONS.IMPERSONATE_USERS })) {
    throw new Error('Missing impersonate permission')
  }

  const actorEmail = user.primaryEmailAddress?.emailAddress
  if (!actorEmail) throw new Error('Could not determine actor email')

  const env = resolveEnvironment(orgId)
  const webappUrl = getWebappUrl(env)

  const { token } = await gpAction((client) =>
    client.admin.impersonateUser(targetUserId, actorEmail)
  )
  return { token, webappUrl }
}
