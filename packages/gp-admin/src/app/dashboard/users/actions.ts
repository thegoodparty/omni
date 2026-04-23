'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { gpAction } from '@/shared/util/gpClient.util'
import {
  resolveEnvironment,
  GP_ENVIRONMENT,
  type GpEnvironment,
} from '@/shared/util/gpEnvironment'
import { PERMISSIONS } from '@/lib/permissions'
import type { UpdateUserInput, User } from '@goodparty_org/sdk'
import {
  SearchUsersParams,
  SearchUsersResult,
  SEARCH_PARAMS,
  DEFAULT_PER_PAGE,
} from './types'

function getWebappUrl(env: GpEnvironment): string {
  const urls: Record<GpEnvironment, string | undefined> = {
    [GP_ENVIRONMENT.DEV]: process.env.NEXT_PUBLIC_GP_DEV_WEBAPP_URL,
    [GP_ENVIRONMENT.QA]: process.env.NEXT_PUBLIC_GP_QA_WEBAPP_URL,
    [GP_ENVIRONMENT.PROD]: process.env.NEXT_PUBLIC_GP_WEBAPP_URL,
  }
  const url = urls[env]
  if (!url) throw new Error(`Webapp URL not configured for environment: ${env}`)
  return url
}

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

    const users = result.data ?? []
    const proFlags = await Promise.all(
      users.map(async ({ id }) => {
        try {
          const { data: campaigns } = await client.campaigns.list({
            userId: id,
          })
          return campaigns.some((c) => c.isPro === true)
        } catch {
          return false
        }
      })
    )

    return {
      data: users.map((user, i) => ({ ...user, isPro: proFlags[i] })),
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

export const createImpersonationToken = async (targetUserId: number) => {
  const { userId: adminClerkId, orgId, has } = await auth()

  if (!adminClerkId || !orgId) throw new Error('Not authenticated')
  if (!has({ permission: PERMISSIONS.IMPERSONATE_USERS })) {
    throw new Error('Missing impersonate permission')
  }

  const env = resolveEnvironment(orgId)
  const webappUrl = getWebappUrl(env)

  const { token } = await gpAction((client) =>
    client.admin.impersonateUser(targetUserId, adminClerkId)
  )
  return { token, webappUrl }
}
