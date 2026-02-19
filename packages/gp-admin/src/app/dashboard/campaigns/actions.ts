'use server'

import { revalidatePath } from 'next/cache'
import { gpAction } from '@/shared/util/gpClient.util'
import type {
  Campaign,
  PaginatedList,
  UpdateCampaignInput,
} from '@goodparty_org/sdk'

export const listCampaigns = async (
  userId: number
): Promise<PaginatedList<Campaign>> =>
  gpAction(async (client) => {
    return client.campaigns.list({ userId })
  })

// TODO: replace this with campaign.get by id when the sdk is updated
export const getCampaign = async (
  campaignId: number,
  userId: number
): Promise<Campaign | undefined> =>
  gpAction(async (client) => {
    const { data } = await client.campaigns.list({ userId })
    return data.find((c) => c.id === campaignId)
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
