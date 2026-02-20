import { notFound } from 'next/navigation'
import { SdkError } from '@goodparty_org/sdk'
import { status } from '@poppanator/http-constants'
import { getPathToVictory } from './actions'

export async function getPathToVictoryOrNotFound(id: number) {
  try {
    return await getPathToVictory(id)
  } catch (error) {
    if (error instanceof SdkError && error.status === status.NotFound) {
      notFound()
    }
    throw error
  }
}
