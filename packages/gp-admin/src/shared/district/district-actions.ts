'use server'

import { revalidatePath } from 'next/cache'
import { gpAction } from '@/shared/util/gpClient.util'
import type {
  DistrictNameItem,
  DistrictTypeItem,
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

export async function updateCampaignDistrict(
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

export async function updateElectedOfficeDistrict(
  electedOfficeId: string,
  state: string,
  L2DistrictType: string,
  L2DistrictName: string,
  userId: number
): Promise<void> {
  await gpAction(async (client) => {
    // The SDK does not yet expose an electedOffices.updateDistrict method.
    // Call the M2M-capable PUT /elected-office/:id/district directly via the
    // SDK's underlying httpClient. Once the SDK is bumped to a release that
    // adds `client.electedOffices.updateDistrict`, swap this call.
    const httpClient = (
      client.electedOffices as unknown as {
        httpClient: {
          request: <T>(
            path: string,
            init: { method: string; body: unknown }
          ) => Promise<T>
        }
      }
    ).httpClient
    await httpClient.request(`/elected-office/${electedOfficeId}/district`, {
      method: 'PUT',
      body: { state, L2DistrictType, L2DistrictName },
    })
    revalidatePath(`/dashboard/users/${userId}`, 'layout')
  })
}
