import { notFound } from 'next/navigation'
import { SdkError } from '@goodparty_org/sdk'
import { status } from '@poppanator/http-constants'
import { getElectedOffice } from './actions'

export async function getElectedOfficeOrNotFound(id: string) {
  try {
    return await getElectedOffice(id)
  } catch (error) {
    if (error instanceof SdkError && error.status === status.NotFound) {
      notFound()
    }
    throw error
  }
}
