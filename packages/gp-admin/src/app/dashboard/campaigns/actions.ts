'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import type {
  Campaign,
  CampaignWithLiveContext,
  CampaignWithPositionName,
  ComplianceStateOutput,
  ExperimentRunStatus,
  PaginatedList,
  UpdateCampaignInput,
} from '@goodparty_org/sdk'
import { COMPLIANCE_SETUP_EXPERIMENT } from '@/app/dashboard/agent-runs/[runId]/complianceSummary'

export type EnrichedCampaign = CampaignWithLiveContext

export const listCampaigns = async (
  userId: number
): Promise<PaginatedList<CampaignWithPositionName>> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
    throw new Error('Missing read_campaigns permission')
  }
  return gpAction(async (client) => {
    return client.campaigns.list({ userId })
  })
}

export const getCampaign = async (
  campaignId: number
): Promise<EnrichedCampaign> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
    throw new Error('Missing read_campaigns permission')
  }
  return gpAction(async (client) => {
    return client.campaigns.get(campaignId)
  })
}

export const updateCampaign = async (
  id: number,
  userId: number,
  input: UpdateCampaignInput
): Promise<Campaign> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    throw new Error('Missing write_campaigns permission')
  }
  return gpAction(async (client) => {
    const campaign = await client.campaigns.update(id, input)
    revalidatePath(`/dashboard/users/${userId}`, 'layout')
    return campaign
  })
}

export const getCampaignComplianceState = async (
  campaignId: number
): Promise<ComplianceStateOutput> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
    throw new Error('Missing read_campaigns permission')
  }
  return gpAction(async (client) => {
    return client.campaigns.getComplianceState(campaignId)
  })
}

export const resendCvPin = async (campaignId: number): Promise<void> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    throw new Error('Missing write_campaigns permission')
  }
  return gpAction(async (client) => {
    return client.campaigns.resendCvPin(campaignId)
  })
}

export const updateCommitteeName = async (
  campaignId: number,
  committeeName: string
): Promise<{ committeeName: string }> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    throw new Error('Missing write_campaigns permission')
  }
  return gpAction(async (client) => {
    return client.campaigns.updateCommitteeName(campaignId, { committeeName })
  })
}

export interface OverrideCvValidationResult {
  retriedRunId: string | null
  retryError: string | null
}

// Clears a CV pre-submission validation hold, then resubmits by retrying the
// campaign's newest FAILED compliance_setup run. When no FAILED run exists
// (the hold was caught mid-flight), the override alone is enough — the
// stranded-kickoff sweep re-dispatches — and retriedRunId is null so the UI
// can say which happened. The retry half is reported via retryError rather
// than thrown: the override has already committed by then, so the caller must
// refresh to the cleared state instead of treating the whole call as failed.
export const overrideCvValidationAndResubmit = async (
  campaignId: number
): Promise<OverrideCvValidationResult> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    throw new Error('Missing write_campaigns permission')
  }
  return gpAction(async (client) => {
    await client.campaigns.overrideCvValidation(campaignId)
    try {
      const { data } = await client.adminAgentRuns.list({
        organizationSlug: `campaign-${campaignId}`,
        experimentType: COMPLIANCE_SETUP_EXPERIMENT,
        status: 'FAILED' satisfies ExperimentRunStatus,
        limit: 1,
        offset: 0,
      })
      const failedRun = data?.[0]
      if (!failedRun) return { retriedRunId: null, retryError: null }
      const retried = await client.adminAgentRuns.retry(failedRun.runId)
      return { retriedRunId: retried.runId, retryError: null }
    } catch (error) {
      return {
        retriedRunId: null,
        retryError:
          error instanceof Error ? error.message : 'Failed to resubmit',
      }
    }
  })
}

export const setInternalTestingApproval = async (
  campaignId: number,
  enabled: boolean
): Promise<void> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    throw new Error('Missing write_campaigns permission')
  }
  return gpAction(async (client) => {
    return enabled
      ? client.campaigns.grantInternalTestingApproval(campaignId)
      : client.campaigns.revokeInternalTestingApproval(campaignId)
  })
}
