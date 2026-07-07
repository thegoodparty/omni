'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import type { AdminOrganization } from '@goodparty_org/sdk'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'

export type {
  AdminOrganization,
  OrgDistrict,
  OrgPosition,
} from '@goodparty_org/sdk'

// Org records are campaign-domain data with no dedicated permission, so this
// read reuses read_campaigns.
export async function getOrganization(
  slug: string
): Promise<AdminOrganization | null> {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
    throw new Error('Missing read_campaigns permission')
  }
  return gpAction(async (client) => {
    try {
      return await client.organizations.get(slug)
    } catch (error) {
      const status = (error as { status?: number })?.status
      if (status === 404) return null
      throw error
    }
  })
}

export async function updateOrganizationPositionName(
  slug: string,
  customPositionName: string | null,
  campaignId: number,
  userId: number
): Promise<void> {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    throw new Error('Missing write_campaigns permission')
  }
  await gpAction(async (client) => {
    await client.organizations.patch(slug, { customPositionName })
    // Org patches don't sync to HubSpot on their own; an empty campaign
    // update triggers gp-api's trackCampaign so candidate_office reflects
    // the corrected position right away.
    await client.campaigns.update(campaignId, {})
    revalidatePath(`/dashboard/users/${userId}`, 'layout')
  })
}
