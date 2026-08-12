import type { Outreach } from 'app/dashboard/outreach/hooks/OutreachContext'

// Relocated from components/OutreachTable.tsx (the legacy table keeps its own
// copy until it is deleted at the final tile swap): the two legacy status
// vocabularies the unified history has to keep rendering.

export interface HistoryRow extends Outreach {
  p2pJob?: { status?: string }
}

type StatusKey =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'paid'
  | 'in_progress'
  | 'completed'
  | 'pending_payment'

// P2P rows (phoneListId != null): `pending` is a real unfinished draft.
const p2pStatusLabels: { [K in StatusKey]: string } = {
  pending: 'Draft',
  approved: 'In review',
  denied: 'Denied',
  paid: 'Scheduled',
  in_progress: 'Scheduled',
  completed: 'Sent',
  pending_payment: 'Pending payment',
}

// Rows without a phone list (robocall, legacy text, social): `pending` means
// "request submitted, fulfilled by the Political Assistant", so it maps to
// "In review" rather than the p2p map's "Draft".
const nonP2pStatusLabels: { [K in StatusKey]: string } = {
  pending: 'In review',
  approved: 'In review',
  denied: 'Denied',
  paid: 'Scheduled',
  in_progress: 'Scheduled',
  completed: 'Sent',
  pending_payment: 'Pending payment',
}

const isStatusKey = (key: string | null | undefined): key is StatusKey =>
  key !== null && key !== undefined && key in nonP2pStatusLabels

const getP2pStatusLabel = (row: HistoryRow): string | null => {
  const { p2pJob, status } = row
  if (!p2pJob?.status || !status || !isStatusKey(status)) {
    return null
  }
  // An active Peerly job displays as sent regardless of the spine status.
  const displayStatus: StatusKey =
    p2pJob.status === 'active' ? 'completed' : status
  return p2pStatusLabels[displayStatus]
}

export const getHistoryStatusLabel = (row: HistoryRow): string | null => {
  // phoneListId marks a row created via the P2P flow, even when its type is
  // normalized to 'text' — its status merges the Peerly job state.
  if (row.phoneListId != null) {
    return getP2pStatusLabel(row)
  }
  const { status } = row
  if (!status || !isStatusKey(status)) {
    return null
  }
  return nonP2pStatusLabels[status]
}
