'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import type {
  ElectedOffice,
  PaginatedList,
  UpdateElectedOfficeInput,
} from '@goodparty_org/sdk'

// Elected offices are campaign-domain data with no dedicated permission, so
// they reuse read/write_campaigns (Sales writes, Read Only views).
export const listElectedOffices = async (
  userId: number
): Promise<PaginatedList<ElectedOffice>> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
    throw new Error('Missing read_campaigns permission')
  }
  return gpAction(async (client) => {
    return client.electedOffices.list({ userId })
  })
}

export const getElectedOffice = async (id: string): Promise<ElectedOffice> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
    throw new Error('Missing read_campaigns permission')
  }
  return gpAction(async (client) => await client.electedOffices.get(id))
}

export const updateElectedOffice = async (
  id: string,
  userId: number,
  input: UpdateElectedOfficeInput
): Promise<ElectedOffice> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    throw new Error('Missing write_campaigns permission')
  }
  return gpAction(async (client) => {
    const electedOffice = await client.electedOffices.update(id, input)
    revalidatePath(`/dashboard/users/${userId}`, 'layout')
    return electedOffice
  })
}
