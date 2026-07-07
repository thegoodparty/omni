import {
  addMonths,
  compareAsc,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
} from 'date-fns'
import { parseIsoDateAsUTC } from 'src/shared/util/date.util'
import {
  BallotReadyMilestone,
  PersonOfficeHolder,
} from '../types/ballotReady.types'
import type { MilestoneWindow, RaceMilestones } from '@goodparty_org/contracts'

// Group BR milestones by category, picking the earliest OPEN and latest
// CLOSE per category. BR returns one row per (category, type, feature)
// combo — e.g. REGISTRATION CLOSE has separate rows for IN_PERSON, MAIL,
// ONLINE deadlines. Earliest OPEN captures the first opportunity to
// register/vote; latest CLOSE captures the final deadline a voter can
// still hit (matters because some states close ONLINE earlier than
// IN_PERSON). UI consumers can render the window without reasoning about
// features. Exported for direct unit testing.
export const collapseMilestones = (
  milestones: BallotReadyMilestone[],
): RaceMilestones => {
  const grouped: Record<string, { opens: string[]; closes: string[] }> = {
    REGISTRATION: { opens: [], closes: [] },
    EARLY_VOTING: { opens: [], closes: [] },
    REQUEST_BALLOT: { opens: [], closes: [] },
  }

  for (const m of milestones) {
    if (!m.date) continue
    const bucket = grouped[m.category]
    if (!bucket) continue
    if (m.type === 'OPEN') bucket.opens.push(m.date)
    else if (m.type === 'CLOSE') bucket.closes.push(m.date)
  }

  return {
    voter_registration: toWindow(grouped.REGISTRATION),
    early_voting: toWindow(grouped.EARLY_VOTING),
    request_ballot: toWindow(grouped.REQUEST_BALLOT),
  }
}

export const toWindow = (bucket?: {
  opens: string[]
  closes: string[]
}): MilestoneWindow | null => {
  if (!bucket) return null
  const start = earliestDate(bucket.opens)
  const end = latestDate(bucket.closes)
  if (start === null && end === null) return null
  return { start, end }
}

// BR's Milestone.date is ISO8601Date (yyyy-MM-dd, no time component) per
// schema introspection 2026-06-01. For that format string sort matches
// chronological order, so compareAsc and lex compare give the same
// result here. We keep compareAsc anyway for CLAUDE.md Rule 28 and so
// the helper stays correct if BR ever swaps to the nullable
// `datetime: ISO8601DateTime` field (which can carry a non-UTC offset
// where lex order would diverge from chronological order). The returned
// value is the input string verbatim — no reformatting needed because
// the source is already yyyy-MM-dd.
export const earliestDate = (values: string[]): string | null => {
  if (values.length === 0) return null
  return values.reduce((a, b) =>
    compareAsc(parseISO(a), parseISO(b)) <= 0 ? a : b,
  )
}

export const latestDate = (values: string[]): string | null => {
  if (values.length === 0) return null
  return values.reduce((a, b) =>
    compareAsc(parseISO(a), parseISO(b)) >= 0 ? a : b,
  )
}

export function getMonthBounds(dateString: string): { gt: string; lt: string } {
  const reference = parseISO(dateString)
  return {
    gt: format(startOfMonth(reference), 'yyyy-MM-dd'),
    lt: format(endOfMonth(reference), 'yyyy-MM-dd'),
  }
}

export const FUTURE_OFFICEHOLDER_WINDOW_MONTHS = 3

/**
 * Pick the office-holder record to pre-fill an elected office from. Prefers the
 * soonest upcoming term that starts within FUTURE_OFFICEHOLDER_WINDOW_MONTHS
 * (an elected-but-not-yet-sworn-in lead), otherwise falls back to the current
 * term. Pure function so it can be unit-tested without hitting BR.
 */
export const selectPreferredOfficeHolder = (
  holders: PersonOfficeHolder[],
  now: Date = new Date(),
): PersonOfficeHolder | null => {
  // BallotReady can return isVacant records that still reference the prior
  // holder (e.g. a seat vacated mid-term). Those must never seed an EO pre-fill
  // for a seat the person no longer holds, so drop them before any selection.
  const active = holders.filter((holder) => !holder.isVacant)
  if (!active.length) return null

  const windowEnd = addMonths(now, FUTURE_OFFICEHOLDER_WINDOW_MONTHS)

  const upcoming = active
    .filter((holder): holder is PersonOfficeHolder & { startAt: string } => {
      if (!holder.startAt) return false
      const start = parseIsoDateAsUTC(holder.startAt)
      return start > now && start <= windowEnd
    })
    .sort(
      (a, b) =>
        parseIsoDateAsUTC(a.startAt).getTime() -
        parseIsoDateAsUTC(b.startAt).getTime(),
    )
  const [soonest] = upcoming
  if (soonest) return soonest

  const current =
    active.find((holder) => holder.isCurrent) ??
    active.find((holder) => {
      const start = holder.startAt ? parseIsoDateAsUTC(holder.startAt) : null
      const end = holder.endAt ? parseIsoDateAsUTC(holder.endAt) : null
      // endAt is the exclusive term boundary (the successor's start day), so a
      // holder is current only while now < endAt — matching isHeldOffice and the
      // half-open [start, end) overlap semantics. Using >= would keep selecting
      // the outgoing holder on the successor's first day.
      return (!start || start <= now) && (!end || end > now)
    })
  return current ?? null
}
