import type { Outreach } from 'app/dashboard/outreach/hooks/OutreachContext'
import type { MembershipState } from 'app/dashboard/shared/membership/deriveMembershipState'

// The two legacy status vocabularies the unified history has to keep
// rendering. One DELIBERATE divergence from the legacy table's vocabulary:
// `completed` renders "Done" here (the v2 design's vocabulary, per the
// prototype's history table) rather than "Sent" — a product call, not drift.

export interface HistoryRow extends Outreach {
  p2pJob?: { status?: string; start_date?: string; end_date?: string }
}

const DAY_MS = 24 * 60 * 60 * 1000

type StatusKey =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'paid'
  | 'in_progress'
  | 'completed'
  | 'pending_payment'
  | 'canceled'
  | 'failed'
  | 'draft'

// P2P rows (phoneListId != null): `pending` only ever reaches the map for
// rows without a vendor job (getP2pStatusLabel remaps pending-with-a-job to
// `paid`, i.e. Scheduled).
const p2pStatusLabels: { [K in StatusKey]: string } = {
  pending: 'Draft',
  approved: 'In review',
  denied: 'Denied',
  paid: 'Scheduled',
  in_progress: 'Scheduled',
  completed: 'Done',
  pending_payment: 'Pending payment',
  canceled: 'Canceled',
  failed: "Couldn't send",
  // Unreachable: getHistoryStatusLabel intercepts `draft` before either map.
  // Kept so the record stays total over StatusKey.
  draft: 'Pro needed',
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
  // A robocall the send chain could not deliver (CallHub failure). The candidate
  // was not charged; see OutreachRobocall.settleState (send_failed).
  failed: "Couldn't send",
  // Unreachable, same as the p2p map's entry above: kept for totality.
  draft: 'Pro needed',
}

const isStatusKey = (key: string | null | undefined): key is StatusKey =>
  key !== null && key !== undefined && key in nonP2pStatusLabels

// A draft's label is never the spine's own vocabulary — it names the next
// step the candidate must clear before they can send, off the membership
// state the hub reads once per page. Without a membership read (the drawer's
// own getHistoryStatusLabel call passes none) there is no next step to name,
// so this returns null rather than assuming the worst case ('Pro needed').
export const DRAFT_LABELS = {
  pro: 'Pro needed',
  verification: 'Verification needed',
  inReview: 'Verification in review',
  pin: 'PIN needed',
  ready: 'Ready to schedule',
} as const

export const draftLabelFor = (
  row: HistoryRow,
  membership: MembershipState | null,
): string | null => {
  if (!membership) return null
  if (membership.tier === 'free') return DRAFT_LABELS.pro
  // Only the texting channels gate on TCR/CV verification — a robocall or
  // other Pro-only draft has nothing left to clear but the send itself.
  const texting = row.outreachType === 'p2p' || row.outreachType === 'text'
  if (!texting) return DRAFT_LABELS.ready
  switch (membership.texting) {
    case 'needs_verification':
      return DRAFT_LABELS.verification
    case 'in_review':
      return DRAFT_LABELS.inReview
    case 'awaiting_pin':
      return DRAFT_LABELS.pin
    case 'cleared':
      return DRAFT_LABELS.ready
  }
}

// A Serve SMS row: an elected official's text to constituents, which shares
// `outreachType: 'text'` with two other things it is not.
//
// The SURFACE decides, not the row's own shape. Inferring Serve from
// `campaignId == null` was the first attempt and is wrong: `campaignId` is
// optional on the client `Outreach` type, so an absent field is
// indistinguishable from an explicit null, and a Win text row that simply
// does not carry one reads as Serve and takes the wrong vocabulary. A Serve
// page only ever lists org-scoped rows and a Win page only ever lists
// campaign-scoped ones, so `isServe` answers the question exactly, with no
// inference from an absence — and it is the same argument the rest of this
// directory already forks Serve copy on (see docs/product-vocabulary.md,
// "A function of isServe").
//
// `phoneListId == null` separates a Serve row from one created through the
// P2P flow, whose type is normalized to 'text'. Already guaranteed by the
// early return in getHistoryStatusLabel; stated anyway so this predicate is
// true on its own terms rather than on its caller's ordering.
const isServeSmsRow = (row: HistoryRow, isServe: boolean): boolean =>
  isServe && row.outreachType === 'text' && row.phoneListId == null

const getP2pStatusLabel = (row: HistoryRow): string | null => {
  const { p2pJob, status } = row
  if (!status || !isStatusKey(status)) {
    return null
  }
  // Cancel deletes the vendor job, so a canceled row has no p2pJob to
  // merge — requiring one here read every canceled campaign as "n/a".
  if (status === 'canceled') {
    return p2pStatusLabels.canceled
  }
  if (!p2pJob?.status) {
    return null
  }
  // An ACTIVE job used to display as sent unconditionally, which held when
  // activation only ever happened around the send. It no longer does: CAS
  // activates scheduled jobs weeks early (auto-activation at approve,
  // 2026-09-09), and an active job with a future window has sent nothing —
  // candidates saw "Done" on queued sends (2026-09-16). So an active job's
  // label follows its own send window, the same UTC-day semantics the
  // backend completion sweep uses: not started until the start_date day
  // begins, done only once the end_date day has fully passed, and
  // "Sending" in between. A pending row WITH a vendor job is a scheduled
  // send awaiting its start day, not an unfinished draft — draft-first
  // finalize leaves the spine at `pending` until the completion sweep
  // advances it, so 'Draft' would be a lie the moment verification
  // cleared.
  if (p2pJob.status === 'active' && p2pJob.start_date && p2pJob.end_date) {
    const now = Date.now()
    const windowStart = Date.parse(`${p2pJob.start_date}T00:00:00Z`)
    const windowClose = Date.parse(`${p2pJob.end_date}T00:00:00Z`) + DAY_MS
    if (!Number.isNaN(windowStart) && !Number.isNaN(windowClose)) {
      if (now < windowStart) {
        return p2pStatusLabels.paid
      }
      return now >= windowClose ? p2pStatusLabels.completed : 'Sending'
    }
  }
  const displayStatus: StatusKey =
    p2pJob.status === 'active'
      ? 'completed'
      : status === 'pending'
        ? 'paid'
        : status
  return p2pStatusLabels[displayStatus]
}

// `membership` (Win, milestone 2) names the next step for a `draft` row;
// `isServe` (Serve) picks the Serve SMS vocabulary. Both default off so every
// existing caller and test behaves exactly as it did.
export const getHistoryStatusLabel = (
  row: HistoryRow,
  membership: MembershipState | null = null,
  isServe = false,
): string | null => {
  if (row.status === 'draft') {
    return draftLabelFor(row, membership)
  }
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
  // A robocall lifecycle reads Scheduled → In progress → Done. Spine `pending`
  // is a paid, scheduled send awaiting its send date (the hold is placed; the
  // send sweep dials it on the day) — read as Scheduled, the sending-channel
  // word, not the non-p2p map's default nor a Political Assistant "In review".
  // On dial the send sweep advances the spine to `in_progress`: the run is
  // actively dialing, which is "In progress" (the same active-run meaning the
  // native channels' branch above carries), not the non-p2p map's legacy
  // "Scheduled". `completed` (at capture) reads "Done" off the map. Legacy text
  // and social share that map but have no in_progress lifecycle, so the map is
  // left untouched and only robocall is relabeled here.
  if (row.outreachType === 'robocall') {
    if (status === 'pending') {
      return 'Scheduled'
    }
    if (status === 'in_progress') {
      return 'In progress'
    }
  }
  // Serve SMS reads the same two words as robocall, for the same reasons, and
  // is relabeled here rather than in the map for the same reason again:
  // legacy Win text and social rows share nonP2pStatusLabels and must not
  // move. Gated on the surface, so a Win text row cannot reach it at all.
  //
  // Its lifecycle is pending_payment → pending → in_progress → completed.
  // `pending` is PAID and waiting for its send date (the Serve purchase
  // handler leaves it there; the delivery service picks it up on the day), so
  // the map's "In review" would tell an official a human is reviewing their
  // request — the Political Assistant meaning, and not what is happening.
  // `in_progress` is set at the fulfilment handoff and holds until the reply
  // ingest completes the row, so the send is out and responses are coming
  // back; the map's "Scheduled" says the opposite of what is true. Both
  // replacement labels already exist in channelMeta's STATUS_DISPLAY, so
  // neither loses its icon or tone. "In progress" rather than "Sending"
  // because this state spans the send AND the days of replies after it —
  // "Sending" would name only its first half.
  if (isServeSmsRow(row, isServe)) {
    if (status === 'pending') {
      return 'Scheduled'
    }
    if (status === 'in_progress') {
      return 'In progress'
    }
  }
  return nonP2pStatusLabels[status]
}
