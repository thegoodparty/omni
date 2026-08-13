'use client'
import { apiRoutes } from 'gpApi/routes'
import { clientFetch } from 'gpApi/clientFetch'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'

interface VoterFileFilters {
  filters: string[]
}

interface VoterFilePayload {
  type: string
  countOnly: boolean
  customFilters?: string
}

export interface CountVoterFileError {
  ok: false
  status?: number
  errorCode?: string
  message?: string
}

export type CountVoterFileResult = number | CountVoterFileError

export const countVoterFile = async (
  type: string,
  customFilters?: VoterFileFilters | string[],
): Promise<CountVoterFileResult> => {
  try {
    const payload: VoterFilePayload = {
      type,
      countOnly: true,
    }

    if (customFilters) {
      const filters: VoterFileFilters = Array.isArray(customFilters)
        ? { filters: customFilters }
        : customFilters
      payload.customFilters = JSON.stringify(filters)
    }

    const resp = await clientFetch<number | File>(
      apiRoutes.voters.voterFile.get,
      payload,
    )

    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        ...extractApiErrorInfo(resp.data),
      }
    }

    const count = resp.data
    if (typeof count === 'number') {
      return count
    }
    return { ok: false }
  } catch (e) {
    console.error('error', e)
    return { ok: false }
  }
}
