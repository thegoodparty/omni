'use server'

import { revalidatePath } from 'next/cache'
import { gpAction } from '@/shared/util/gpClient.util'
import type {
  ElectedOffice,
  PaginatedList,
  UpdateElectedOfficeInput,
} from '@goodparty_org/sdk'

export const listElectedOffices = async (
  userId: number
): Promise<PaginatedList<ElectedOffice>> =>
  gpAction(async (client) => {
    return client.electedOffices.list({ userId })
  })

export const getElectedOffice = async (id: string): Promise<ElectedOffice> =>
  gpAction(async (client) => await client.electedOffices.get(id))

export const updateElectedOffice = async (
  id: string,
  userId: number,
  input: UpdateElectedOfficeInput
): Promise<ElectedOffice> =>
  gpAction(async (client) => {
    const electedOffice = await client.electedOffices.update(id, input)
    revalidatePath(`/dashboard/users/${userId}`, 'layout')
    return electedOffice
  })
