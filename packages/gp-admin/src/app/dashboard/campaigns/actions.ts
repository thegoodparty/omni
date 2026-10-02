'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import { extractApiErrorMessage } from '@/lib/utils/sdkError'
import { SdkError } from '@goodparty_org/sdk'
import type {
  Campaign,
  CampaignWithLiveContext,
  GoodPartyClient,
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

export type ResendCvPinResult = { error: string | null }

// Failures are returned, not thrown: Next redacts a thrown server-action
// error's message in prod, and gp-api's 4xx messages here (PIN already
// verified, CV not approved yet) are exactly what the staff member needs to
// read.
export const resendCvPin = async (
  campaignId: number
): Promise<ResendCvPinResult> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    return { error: 'Missing write_campaigns permission' }
  }
  try {
    await gpAction((client) => client.campaigns.resendCvPin(campaignId))
    return { error: null }
  } catch (error) {
    return {
      error:
        error instanceof SdkError
          ? extractApiErrorMessage(error, 'Failed to resend CV PIN')
          : error instanceof Error
            ? error.message
            : 'Failed to resend CV PIN',
    }
  }
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

// The resubmit half shared by the hold-clearing actions below. Failures are
// reported via retryError rather than thrown: by the time this runs the
// hold-clearing write has already committed, so the caller must refresh to
// the cleared state instead of treating the whole call as failed.
const retryNewestFailedComplianceRun = async (
  client: GoodPartyClient,
  campaignId: number
): Promise<OverrideCvValidationResult> => {
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
      retryError: error instanceof Error ? error.message : 'Failed to resubmit',
    }
  }
}

// Clears a CV pre-submission validation hold, then resubmits by retrying the
// campaign's newest FAILED compliance_setup run. When no FAILED run exists
// (the hold was caught mid-flight), the override alone is enough — the
// stranded-kickoff sweep re-dispatches — and retriedRunId is null so the UI
// can say which happened.
export const overrideCvValidationAndResubmit = async (
  campaignId: number
): Promise<OverrideCvValidationResult> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    throw new Error('Missing write_campaigns permission')
  }
  return gpAction(async (client) => {
    await client.campaigns.overrideCvValidation(campaignId)
    return retryNewestFailedComplianceRun(client, campaignId)
  })
}

export interface UpdateFilingUrlResult extends OverrideCvValidationResult {
  error: string | null
}

// Staff filing-link correction. gp-api clears the CV validation hold when the
// URL actually changes, so this resubmits the same way the override does. The
// update's own failure is returned, not thrown: gp-api's 4xx messages (URL
// CampaignVerify would reject, registration already at Peerly) are exactly
// what the staff member needs to read, and Next redacts thrown server-action
// errors in prod.
export const updateFilingUrlAndResubmit = async (
  campaignId: number,
  filingUrl: string
): Promise<UpdateFilingUrlResult> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    return {
      error: 'Missing write_campaigns permission',
      retriedRunId: null,
      retryError: null,
    }
  }
  return gpAction(async (client) => {
    try {
      await client.campaigns.updateFilingUrl(campaignId, { filingUrl })
    } catch (error) {
      return {
        error:
          error instanceof SdkError
            ? extractApiErrorMessage(error, 'Failed to update the filing link')
            : error instanceof Error
              ? error.message
              : 'Failed to update the filing link',
        retriedRunId: null,
        retryError: null,
      }
    }
    return {
      error: null,
      ...(await retryNewestFailedComplianceRun(client, campaignId)),
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
