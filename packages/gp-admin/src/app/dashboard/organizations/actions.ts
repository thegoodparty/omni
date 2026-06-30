'use server'

import { auth } from '@clerk/nextjs/server'
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
