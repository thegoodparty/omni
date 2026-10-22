import type { PollApprovalStatus } from '@goodparty_org/contracts'

export type QueueTab = 'awaiting' | 'approved' | 'denied' | 'canceled'

export const TAB_LABELS: Record<QueueTab, string> = {
  awaiting: 'Awaiting review',
  approved: 'Approved',
  denied: 'Denied',
  canceled: 'Canceled',
}

export const TAB_STATUSES: Record<QueueTab, PollApprovalStatus[]> = {
  awaiting: ['awaiting_review'],
  approved: ['approved', 'sent'],
  denied: ['denied'],
  canceled: ['canceled'],
}

export const STATUS_LABELS: Record<PollApprovalStatus, string> = {
  awaiting_review: 'Awaiting review',
  approved: 'Approved',
  denied: 'Denied',
  sent: 'Sent',
  canceled: 'Canceled',
}

export const STATUS_COLORS: Record<
  PollApprovalStatus,
  'amber' | 'red' | 'green' | 'gray'
> = {
  awaiting_review: 'amber',
  approved: 'green',
  denied: 'red',
  sent: 'green',
  canceled: 'gray',
}

export type PollActionResult = { error: string | null }
