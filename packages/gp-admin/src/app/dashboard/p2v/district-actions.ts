'use server'

import { revalidatePath } from 'next/cache'
import { gpAction } from '@/shared/util/gpClient.util'
import type {
  DistrictTypeItem,
  DistrictNameItem,
  ReadCampaignOutput,
} from '@goodparty_org/sdk'

export async function fetchDistrictTypes(
  state: string,
  electionYear: number,
  excludeInvalid?: boolean
): Promise<DistrictTypeItem[]> {
  return gpAction(async (client) => {
    return client.elections.listDistrictTypes({
      state,
      electionYear,
      excludeInvalid,
    })
  })
}

export async function fetchDistrictNames(
  state: string,
  electionYear: number,
  L2DistrictType: string,
  excludeInvalid?: boolean
): Promise<DistrictNameItem[]> {
  return gpAction(async (client) => {
    return client.elections.listDistrictNames({
      state,
      electionYear,
      L2DistrictType,
      excludeInvalid,
    })
  })
}

export async function updateDistrict(
  campaignId: number,
  L2DistrictType: string,
  L2DistrictName: string,
  userId: number
): Promise<void> {
  await gpAction(async (client) => {
    await client.campaigns.updateDistrict(campaignId, {
      L2DistrictType,
      L2DistrictName,
    })
    revalidatePath(`/dashboard/users/${userId}`, 'layout')
  })
}

export async function getCampaign(
  campaignId: number
): Promise<ReadCampaignOutput> {
  return gpAction(async (client) => {
    return client.campaigns.get(campaignId)
  })
}
