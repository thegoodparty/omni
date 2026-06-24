'use client'

import { addDays, format, parse } from 'date-fns'
import { Label } from '@styleguide'
import { cn } from '@styleguide/lib/utils'
import DateInputCalendar from '@shared/inputs/DateInputCalendar'
import type { ElectedOffice } from 'gpApi/api-endpoints'

export type DisabledRange = { from: Date; to: Date }

export const FAR_FUTURE = new Date(3000, 0, 1)
export const FAR_PAST = new Date(1900, 0, 1)

// Term dates legitimately reach into the future (a term end, or a soon-to-be
// sworn-in official's start), so the calendar's year dropdown must span well
// past today rather than capping at the current year.
export const CALENDAR_START = new Date(2000, 0, 1)
export const CALENDAR_END = new Date(new Date().getFullYear() + 20, 11, 31)

export const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined
  const parsed = parse(value, 'yyyy-MM-dd', new Date())
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

export const toApiDate = (value: Date | undefined): string | null =>
  value ? format(value, 'yyyy-MM-dd') : null

export const formatDisplay = (date: Date | undefined): string =>
  date ? format(date, 'MMMM d, yyyy') : 'Not set'

/**
 * The user's OTHER offices, as disabled date ranges for the term-date pickers
 * and the overlap check. Stores the EXCLUSIVE end (termEndDate is the
 * successor's start day) so the overlap check matches the API's half-open
 * dateRangesOverlap; the inclusive calendar matcher decrements it by a day.
 *
 * Mirrors the server's dateRangesOverlap null-handling so the UI never blocks
 * dates the API would accept: an office with a null START (all-null placeholder
 * OR a partial BallotReady prefill with only an end) is non-comparable and is
 * skipped; a non-null start with a null end is an indefinite term that blocks
 * from its start onward (FAR_FUTURE).
 */
export const buildDisabledRanges = (
  offices: ElectedOffice[],
  excludeId: string | undefined,
): DisabledRange[] =>
  offices
    .filter((office) => office.id !== excludeId)
    .filter((office) => !!office.termStartDate)
    .map((office) => ({
      from: toDate(office.termStartDate) ?? FAR_PAST,
      to: toDate(office.termEndDate) ?? FAR_FUTURE,
    }))

// range.to is the exclusive term end; the day-picker's disabled matcher is
// inclusive, so decrement by a day to leave the boundary day selectable for a
// consecutive term (matching the half-open API semantics).
export const startDisabledMatchers = (
  otherRanges: DisabledRange[],
): { from: Date; to: Date }[] =>
  otherRanges.map((range) => ({ from: range.from, to: addDays(range.to, -1) }))

export const endDisabledMatchers = (
  otherRanges: DisabledRange[],
  termStartDate: Date | undefined,
): ({ from: Date; to: Date } | { before: Date })[] => {
  const base = startDisabledMatchers(otherRanges)
  if (!termStartDate) return base
  return [...base, { before: addDays(termStartDate, 1) }]
}

// Terms are half-open [start, end): the end date is the exclusive boundary
// where the successor takes over, so a new term that starts exactly on a prior
// term's end day does not overlap — must match the API's dateRangesOverlap
// (< not <=).
export const overlapsExisting = (
  termStartDate: Date | undefined,
  termEndDate: Date | undefined,
  otherRanges: DisabledRange[],
): boolean => {
  if (!termStartDate && !termEndDate) return false
  const start = termStartDate ?? FAR_PAST
  const end = termEndDate ?? FAR_FUTURE
  return otherRanges.some((range) => start < range.to && range.from < end)
}

export const termDatesValid = (
  termStartDate: Date | undefined,
  termEndDate: Date | undefined,
  otherRanges: DisabledRange[],
): boolean =>
  !!termStartDate &&
  !!termEndDate &&
  termStartDate < termEndDate &&
  !overlapsExisting(termStartDate, termEndDate, otherRanges)

export const termDateError = (
  termStartDate: Date | undefined,
  termEndDate: Date | undefined,
  otherRanges: DisabledRange[],
): string | null => {
  if (!termStartDate || !termEndDate) {
    return 'Enter both your term start and end dates to continue.'
  }
  if (termStartDate >= termEndDate) {
    return 'Your term end date must be after your start date.'
  }
  if (overlapsExisting(termStartDate, termEndDate, otherRanges)) {
    return 'These dates overlap a term you already hold. Adjust them so your offices don’t overlap.'
  }
  return null
}

// Scope GoodParty brand blue (the `primary` token already used across serve
// onboarding CTAs and the progress bar) to THIS calendar only. The shared
// <Calendar> defaults to neutral gray for its selected/today/focus states; we
// override them here via descendant selectors on the day-picker root so the
// shared component used by win onboarding and poll scheduling stays untouched.
const BRAND_CALENDAR_CLASSNAME = cn(
  'rounded-lg border shadow-sm',
  // Selected day -> solid brand blue.
  '[&_[data-selected-single=true]]:!bg-primary',
  '[&_[data-selected-single=true]]:!text-primary-foreground',
  '[&_[data-selected-single=true]]:hover:!bg-primary/90',
  // Today -> soft brand-blue accent (selected still wins, see above).
  '[&_[data-today=true]]:!bg-primary/10',
  '[&_[data-today=true]]:!text-primary',
  // Keyboard focus ring on day cells -> brand blue.
  '[&_button[data-day]]:focus:!ring-primary/50',
  '[&_button[data-day]]:focus-visible:!ring-primary/50',
)

/**
 * The two term-date calendars (start + end) with their disabled ranges and a
 * shared error line. Used by both the serve onboarding term-dates step and the
 * dashboard term-date prompt so the picker + validation never diverge.
 */
export const TermDatesFields = ({
  termStartDate,
  termEndDate,
  onStartChange,
  onEndChange,
  otherRanges,
  error,
  calendarStart = CALENDAR_START,
  calendarEnd = CALENDAR_END,
}: {
  termStartDate: Date | undefined
  termEndDate: Date | undefined
  onStartChange: (date: Date | undefined) => void
  onEndChange: (date: Date | undefined) => void
  otherRanges: DisabledRange[]
  error: string | null
  calendarStart?: Date
  calendarEnd?: Date
}): React.JSX.Element => {
  const startDisabled = startDisabledMatchers(otherRanges)
  const endDisabled = endDisabledMatchers(otherRanges, termStartDate)
  return (
    <>
      {/* Each field stacks its own always-open inline calendar. The calendars
          render at a fixed natural width, so a two-column grid collapses them
          into columns narrower than the calendars themselves once the right-rail
          layout shrinks the content area — the two month grids then overrun and
          collide. Stacking gives each calendar the full content width (centered,
          never overlapping) and wraps it in an x-scroll guard so it can't break
          the layout on a narrow viewport either. */}
      <div className="grid grid-cols-1 gap-8">
        <div className="space-y-2">
          <Label>Term start date</Label>
          <div className="overflow-x-auto">
            <DateInputCalendar
              value={termStartDate}
              onChange={onStartChange}
              showTextInput
              label=""
              calendarClassName={BRAND_CALENDAR_CLASSNAME}
              startMonth={calendarStart}
              endMonth={calendarEnd}
              disabled={startDisabled}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Term end date</Label>
          <div className="overflow-x-auto">
            <DateInputCalendar
              value={termEndDate}
              onChange={onEndChange}
              showTextInput
              label=""
              calendarClassName={BRAND_CALENDAR_CLASSNAME}
              startMonth={calendarStart}
              endMonth={calendarEnd}
              disabled={endDisabled}
            />
          </div>
        </div>
      </div>
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
    </>
  )
}
