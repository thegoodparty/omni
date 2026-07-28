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
  PaginatedList,
  UpdateCampaignInput,
} from '@goodparty_org/sdk'

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
