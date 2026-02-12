'use server'

import { gpAction } from '@/shared/util/gpClient.util'
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
