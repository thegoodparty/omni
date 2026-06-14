import { differenceInCalendarDays, isValid, parseISO } from 'date-fns'
import { getMidnightForDate } from '@/shared/util/date.util'

export type DerivedTermFields = {
  electedDate: Date | null
  termStartAt: Date | null
  termEndAt: Date | null
  termLengthDays: number | null
}

type DeriveTermFieldsInput = {
  frequency: number[]
  electionDate: string | null
  swornInDate?: Date | null
}

// BallotReady's PositionElection `frequency` is the repeating sequence of
// year-gaps between a position's elections, anchored at a referenceYear we do
// not store. For the common single-element cadence ([4], [2]) the term is
// unambiguous. For a staggered multi-element cadence ([2, 4]) the per-seat
// term alternates and can't be pinned without referenceYear, so we take the
// longest gap: it avoids the naive frequency[0] reading and errs toward
// keeping the office "held" longer — the safe direction for the eligibility
// gate, which must not prematurely free a user to gain a second office.
const termLengthYearsFromFrequency = (frequency: number[]): number | null => {
  const positive = frequency.filter((years) => years > 0)
  return positive.length ? Math.max(...positive) : null
}

// Term boundaries are calendar dates, not wall-clock moments, so add the term
// length on the UTC calendar. date-fns `addYears` works in local time and
// would shift the stored instant by the DST delta on servers off UTC (a [4]
// term landing a day early across a fall-back boundary). Mirrors
// `getMidnightForDate`'s UTC-component construction.
const addYearsUTC = (date: Date, years: number): Date =>
  new Date(
    Date.UTC(
      date.getUTCFullYear() + years,
      date.getUTCMonth(),
      date.getUTCDate(),
    ),
  )

export const deriveTermFields = ({
  frequency,
  electionDate,
  swornInDate,
}: DeriveTermFieldsInput): DerivedTermFields => {
  const parsedElection = electionDate ? parseISO(electionDate) : null
  const electedDate =
    parsedElection && isValid(parsedElection)
      ? getMidnightForDate(parsedElection)
      : null
  const termStartAt = swornInDate
    ? getMidnightForDate(swornInDate)
    : electedDate
  const termLengthYears = termLengthYearsFromFrequency(frequency)

  if (!termStartAt || termLengthYears === null) {
    return { electedDate, termStartAt, termEndAt: null, termLengthDays: null }
  }

  const termEndAt = addYearsUTC(termStartAt, termLengthYears)
  return {
    electedDate,
    termStartAt,
    termEndAt,
    termLengthDays: differenceInCalendarDays(termEndAt, termStartAt),
  }
}
