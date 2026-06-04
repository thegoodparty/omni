'use server'

import { revalidatePath } from 'next/cache'
import { gpAction } from '@/shared/util/gpClient.util'
import type {
  Campaign,
  CampaignWithLiveContext,
  CampaignWithPositionName,
  PaginatedList,
  UpdateCampaignInput,
} from '@goodparty_org/sdk'

export type EnrichedCampaign = CampaignWithLiveContext

export const listCampaigns = async (
  userId: number
): Promise<PaginatedList<CampaignWithPositionName>> =>
  gpAction(async (client) => {
    return client.campaigns.list({ userId })
  })

export const getCampaign = async (
  campaignId: number
): Promise<EnrichedCampaign> =>
  gpAction(async (client) => {
    return client.campaigns.get(campaignId)
  })

export const updateCampaign = async (
  id: number,
  userId: number,
  input: UpdateCampaignInput
): Promise<Campaign> =>
  gpAction(async (client) => {
    const campaign = await client.campaigns.update(id, input)
    revalidatePath(`/dashboard/users/${userId}`, 'layout')
    return campaign
  })
