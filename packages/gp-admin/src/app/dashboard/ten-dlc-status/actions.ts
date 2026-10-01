'use server'

import { auth } from '@clerk/nextjs/server'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import type { TenDlcStatusSnapshot } from '@goodparty_org/sdk'

export const getTenDlcStatusSnapshot =
  async (): Promise<TenDlcStatusSnapshot> => {
    const { has } = await auth()
    if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
      throw new Error('Missing read_campaigns permission')
    }
    return gpAction((client) => client.campaigns.getTenDlcStatusSnapshot())
  }
