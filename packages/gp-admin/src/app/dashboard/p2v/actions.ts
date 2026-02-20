'use server'

import { revalidatePath } from 'next/cache'
import { gpAction } from '@/shared/util/gpClient.util'
import type {
  PathToVictory,
  PaginatedList,
  UpdatePathToVictoryInput,
} from '@goodparty_org/sdk'

export const listPathsToVictory = async (
  userId: number
): Promise<PaginatedList<PathToVictory>> =>
  gpAction(async (client) => {
    return client.pathsToVictory.list({ userId })
  })

export const getPathToVictory = async (id: number): Promise<PathToVictory> =>
  gpAction(async (client) => {
    return await client.pathsToVictory.get(id)
  })

export const updatePathToVictory = async (
  id: number,
  userId: number,
  input: UpdatePathToVictoryInput
): Promise<PathToVictory> =>
  gpAction(async (client) => {
    const p2v = await client.pathsToVictory.update(id, input)
    revalidatePath(`/dashboard/users/${userId}`, 'layout')
    return p2v
  })
