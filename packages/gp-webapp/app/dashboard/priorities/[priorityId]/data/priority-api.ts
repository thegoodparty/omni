'use client'

import {
  parsePriorityStatus,
  type PriorityStatus,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'

export interface PriorityStatusRead {
  status: PriorityStatus
  nextAction: string | null
}

/**
 * The persisted status. Read after a turn settles so an interrupted stream
 * cannot leave the rail showing a move the server never wrote.
 */
export const fetchPriorityStatus = async (
  priorityId: string,
): Promise<PriorityStatusRead | null> => {
  try {
    const { data } = await clientRequest('GET /v1/priorities/:id/status', {
      id: priorityId,
    })
    return {
      status: parsePriorityStatus(data.status),
      nextAction: data.nextAction,
    }
  } catch {
    // The rail keeps what it already has rather than blanking on a failed
    // reconcile; the next turn tries again.
    return null
  }
}
