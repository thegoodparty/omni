'use server'

import { gpAction } from '@/shared/util/gpClient.util'
import {
  SearchUsersParams,
  SearchUsersResult,
  SEARCH_PARAMS,
} from './types'

const DEFAULT_LIMIT = 30

export const searchUsers = async (
  params: SearchUsersParams
): Promise<SearchUsersResult> =>
  gpAction(async (client) => {
    const { data } = await client.users.list({
      limit: DEFAULT_LIMIT,
      firstName: params[SEARCH_PARAMS.FIRST_NAME],
      lastName: params[SEARCH_PARAMS.LAST_NAME],
      email: params[SEARCH_PARAMS.EMAIL],
    })
    return data ?? []
  })
