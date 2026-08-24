import type { Outreach } from 'app/dashboard/outreach/hooks/OutreachContext'

// Relocated from components/OutreachTable.tsx (the legacy table keeps its own
// copy until it is deleted at the final tile swap): the two legacy status
// vocabularies the unified history has to keep rendering. One DELIBERATE
// divergence from the legacy copy: `completed` renders "Done" here (the v2
// design's vocabulary, per the prototype's history table) while the legacy
// table keeps "Sent" — the surfaces are never shown together, and the v2
// wording is a product call, not drift.

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
  | 'canceled'

// P2P rows (phoneListId != null): `pending` is a real unfinished draft.
const p2pStatusLabels: { [K in StatusKey]: string } = {
  pending: 'Draft',
  approved: 'In review',
  denied: 'Denied',
  paid: 'Scheduled',
  in_progress: 'Scheduled',
  completed: 'Done',
  pending_payment: 'Pending payment',
  canceled: 'Canceled',
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
  completed: 'Done',
  pending_payment: 'Pending payment',
  canceled: 'Canceled',
}

const isStatusKey = (key: string | null | undefined): key is StatusKey =>
  key !== null && key !== undefined && key in nonP2pStatusLabels

const getP2pStatusLabel = (row: HistoryRow): string | null => {
  const { p2pJob, status } = row
  if (!p2pJob?.status || !status || !isStatusKey(status)) {
    return null
  }
  // An active Peerly job displays as sent regardless of the spine status —
  // except a canceled row, whose vendor job was deleted by the cancel.
  const displayStatus: StatusKey =
    p2pJob.status === 'active' && status !== 'canceled' ? 'completed' : status
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
  // The native channels only ever carry in_progress/completed, and their
  // in_progress means the work is actively happening — callers dialing, a
  // canvasser walking — not the non-p2p map's "Scheduled", which is a legacy
  // pre-send state. Both read "In progress" so one vocabulary covers both.
  if (
    (row.outreachType === 'nativePhoneBanking' ||
      row.outreachType === 'nativeDoorKnocking') &&
    status === 'in_progress'
  ) {
    return 'In progress'
  }
  return nonP2pStatusLabels[status]
}
