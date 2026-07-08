'use server'

import { auth } from '@clerk/nextjs/server'
import type {
  BriefingDispatchPreview,
  CommunityIssuesDispatchResult,
  DispatchMeetingAgentResult,
  MeetingAgentDispatchKind,
} from '@goodparty_org/sdk'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import { AGENT_JOB_TYPE_LIST, type AgentJobsStatus } from './agentJobs'

export const getAgentJobsStatus = async (
  organizationSlug: string
): Promise<AgentJobsStatus> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.READ_AGENT_RUNS })) {
    throw new Error('Missing read_agent_runs permission')
  }
  return gpAction(async (client) => {
    const entries = await Promise.all(
      AGENT_JOB_TYPE_LIST.map(async (experimentType) => {
        const result = await client.adminAgentRuns.list({
          organizationSlug,
          experimentType,
          limit: 1,
        })
        return [experimentType, result.data?.[0] ?? null] as const
      })
    )
    return Object.fromEntries(entries) as AgentJobsStatus
  })
}

export const getBriefingDispatchPreview = async (
  electedOfficeId: string
): Promise<BriefingDispatchPreview> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.READ_AGENT_RUNS })) {
    throw new Error('Missing read_agent_runs permission')
  }
  return gpAction((client) =>
    client.meetingBriefings.dispatchPreview(electedOfficeId)
  )
}

export const dispatchMeetingAgent = async (input: {
  electedOfficeId: string
  kind: MeetingAgentDispatchKind
  useImminenceGate: boolean
}): Promise<DispatchMeetingAgentResult> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.WRITE_AGENT_RUNS })) {
    throw new Error('Missing write_agent_runs permission')
  }
  return gpAction((client) => client.meetingBriefings.dispatch(input))
}

export const dispatchCommunityIssues = async (
  organizationSlug: string
): Promise<CommunityIssuesDispatchResult> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.WRITE_AGENT_RUNS })) {
    throw new Error('Missing write_agent_runs permission')
  }
  return gpAction((client) =>
    client.communityIssues.dispatch({ orgSlugs: [organizationSlug] })
  )
}
