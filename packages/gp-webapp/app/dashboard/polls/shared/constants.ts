import { MAX_LIST_SAMPLE_SIZE, PRICE_PER_TEXT } from '@goodparty_org/contracts'
import { PollStatus } from './poll-types'

export const POLL_STATUS_LABELS: Record<PollStatus, string> = {
  [PollStatus.COMPLETED]: 'Completed',
  [PollStatus.IN_PROGRESS]: 'In Progress',
  [PollStatus.SCHEDULED]: 'Scheduled',
}

/** In dollars */
export const PRICE_PER_POLL_TEXT = PRICE_PER_TEXT

export const MAX_CONSTITUENTS_PER_RUN = MAX_LIST_SAMPLE_SIZE
