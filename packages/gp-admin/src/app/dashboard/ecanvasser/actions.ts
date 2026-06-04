'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import type {
  CreateEcanvasserInput,
  Ecanvasser,
  EcanvasserSummary,
} from '@goodparty_org/sdk'

const ECANVASSER_PATH = '/dashboard/ecanvasser'

async function requireManageEcanvasser() {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.MANAGE_ECANVASSER })) {
    throw new Error('Unauthorized: Missing manage_ecanvasser permission')
  }
}

export const listEcanvassers = async (): Promise<EcanvasserSummary[]> => {
  await requireManageEcanvasser()
  return gpAction(async (client) => {
    return client.ecanvasser.list()
  })
}

export const createEcanvasser = async (
  input: CreateEcanvasserInput
): Promise<Ecanvasser> => {
  await requireManageEcanvasser()
  return gpAction(async (client) => {
    const result = await client.ecanvasser.create(input)
    revalidatePath(ECANVASSER_PATH)
    return result
  })
}

export const syncAllEcanvassers = async (): Promise<EcanvasserSummary[]> => {
  await requireManageEcanvasser()
  return gpAction(async (client) => {
    await client.ecanvasser.syncAll()
    revalidatePath(ECANVASSER_PATH)
    return client.ecanvasser.list()
  })
}

export const deleteEcanvasser = async (campaignId: number): Promise<void> => {
  await requireManageEcanvasser()
  return gpAction(async (client) => {
    await client.ecanvasser.delete(campaignId)
    revalidatePath(ECANVASSER_PATH)
  })
}
