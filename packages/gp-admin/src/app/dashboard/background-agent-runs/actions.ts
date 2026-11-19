'use server'

import { auth } from '@clerk/nextjs/server'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import {
  buildBackgroundAgentRunsQuery,
  SearchBackgroundAgentRunsParams,
  SearchBackgroundAgentRunsResult,
} from './types'

export const searchBackgroundAgentRuns = async (
  params: SearchBackgroundAgentRunsParams
): Promise<SearchBackgroundAgentRunsResult> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.READ_AGENT_RUNS })) {
    throw new Error('Missing read_agent_runs permission')
  }
  return gpAction(async (client) => {
    const result = await client.adminBackgroundAgentRuns.list(
      buildBackgroundAgentRunsQuery(params)
    )
    return {
      data: result.data ?? [],
      meta: result.meta,
    }
  })
}
