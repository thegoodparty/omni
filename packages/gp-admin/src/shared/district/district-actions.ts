'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import type { DistrictNameItem, DistrictTypeItem } from '@goodparty_org/sdk'

// District actions operate on campaign / elected-office data, which has no
// dedicated permission, so they reuse read/write_campaigns (Sales writes,
// Read Only views) — same gating as the campaigns/elected-offices actions.
export async function fetchDistrictTypes(
  state: string,
  electionYear: number,
  excludeInvalid?: boolean
): Promise<DistrictTypeItem[]> {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
    throw new Error('Missing read_campaigns permission')
  }
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
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
    throw new Error('Missing read_campaigns permission')
  }
  return gpAction(async (client) => {
    return client.elections.listDistrictNames({
      state,
      electionYear,
      L2DistrictType,
      excludeInvalid,
    })
  })
}

export async function updateCampaignDistrict(
  campaignId: number,
  L2DistrictType: string,
  L2DistrictName: string,
  userId: number
): Promise<void> {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    throw new Error('Missing write_campaigns permission')
  }
  await gpAction(async (client) => {
    await client.campaigns.updateDistrict(campaignId, {
      L2DistrictType,
      L2DistrictName,
    })
    revalidatePath(`/dashboard/users/${userId}`, 'layout')
  })
}

export async function updateElectedOfficeDistrict(
  electedOfficeId: string,
  state: string,
  L2DistrictType: string,
  L2DistrictName: string,
  userId: number
): Promise<void> {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    throw new Error('Missing write_campaigns permission')
  }
  await gpAction(async (client) => {
    await client.electedOffices.updateDistrict(electedOfficeId, {
      state,
      L2DistrictType,
      L2DistrictName,
    })
    revalidatePath(`/dashboard/users/${userId}`, 'layout')
  })
}
