'use server'

import { revalidatePath } from 'next/cache'
import { gpAction } from '@/shared/util/gpClient.util'
import type {
  CreateEcanvasserInput,
  Ecanvasser,
  EcanvasserSummary,
} from '@goodparty_org/sdk'

const ECANVASSER_PATH = '/dashboard/ecanvasser'

export const listEcanvassers = async (): Promise<EcanvasserSummary[]> =>
  gpAction(async (client) => {
    return client.ecanvasser.list()
  })

export const createEcanvasser = async (
  input: CreateEcanvasserInput
): Promise<Ecanvasser> =>
  gpAction(async (client) => {
    const result = await client.ecanvasser.create(input)
    revalidatePath(ECANVASSER_PATH)
    return result
  })

export const syncAllEcanvassers = async (): Promise<EcanvasserSummary[]> =>
  gpAction(async (client) => {
    await client.ecanvasser.syncAll()
    revalidatePath(ECANVASSER_PATH)
    return client.ecanvasser.list()
  })

export const deleteEcanvasser = async (campaignId: number): Promise<void> =>
  gpAction(async (client) => {
    await client.ecanvasser.delete(campaignId)
    revalidatePath(ECANVASSER_PATH)
  })
