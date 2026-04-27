'use server'

import type { Organization } from '@goodparty_org/sdk'
import { gpAction } from '@/shared/util/gpClient.util'

export type { Organization, OrgDistrict, OrgPosition } from '@goodparty_org/sdk'

export async function getOrganization(
  slug: string
): Promise<Organization | null> {
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
