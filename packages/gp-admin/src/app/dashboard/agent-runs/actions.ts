'use server'

import { auth } from '@clerk/nextjs/server'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import {
  buildAgentRunsQuery,
  SearchAgentRunsParams,
  SearchAgentRunsResult,
} from './types'

export const searchAgentRuns = async (
  params: SearchAgentRunsParams
): Promise<SearchAgentRunsResult> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.READ_AGENT_RUNS })) {
    throw new Error('Missing read_agent_runs permission')
  }
  return gpAction(async (client) => {
    const result = await client.adminAgentRuns.list(buildAgentRunsQuery(params))
    return {
      data: result.data ?? [],
      meta: result.meta,
    }
  })
}

export const retryAgentRun = async (runId: string): Promise<string> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.WRITE_AGENT_RUNS })) {
    throw new Error('Missing write_agent_runs permission')
  }
  return gpAction(async (client) => {
    const run = await client.adminAgentRuns.retry(runId)
    return run.runId
  })
}
