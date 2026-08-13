import {
  DateArg,
  endOfDay,
  format,
  isBefore,
  isMonday,
  isValid,
  nextMonday,
  parse,
  parseISO,
  startOfDay,
  startOfWeek,
  subDays,
} from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

export const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

export const CENTRAL_TIMEZONE = 'America/Chicago'

export const EASTERN_TIMEZONE = 'America/New_York'

// The upcoming calendar Monday at UTC midnight, picked in `timeZone` so the
// "which Monday" choice follows local intent — e.g. Sunday 11pm Central is
// still "Sunday" locally though it is already Monday in UTC. Shared by the
// weekly digest window and the tracker task dating so both agree on the week
// boundary (tasks are stored as naive UTC-midnight calendar dates).
export const nextMondayUtcMidnight = (now: Date, timeZone: string): Date => {
  const nowInZone = toZonedTime(now, timeZone)
  // date-fns nextMonday on a Monday returns the FOLLOWING Monday, so when this
  // runs on a Monday (async CAP completion or a Monday plan-page load) the week
  // would land 7 days ahead. Use today when it's already Monday.
  const monday = isMonday(nowInZone) ? nowInZone : nextMonday(nowInZone)
  return new Date(
    Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()),
  )
}

// The Monday (UTC midnight) of the week containing `date`, read by its UTC
// calendar day. Aligns an arbitrary stored task date to its Mon-Sun week (task
// dates are naive UTC-midnight), e.g. to window the Pro-upgrade Slack post from
// the earliest task, which may fall on any weekday.
export const mondayOfWeekUtc = (date: Date): Date => {
  const monday = startOfWeek(toZonedTime(date, 'UTC'), { weekStartsOn: 1 })
  return new Date(
    Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()),
  )
}

export const toDateOnlyString = (d?: Date | null) => {
  return d ? d.toISOString().slice(0, 10) : undefined
}

export enum DateFormats {
  isoDate = 'yyyy-MM-dd',
  usDate = 'MMMM d, yyyy',
  crmPropertyMonthDate = 'MMMyy',
  usIsoSlashes = 'MM/dd/yyyy',
}

export function formatDate(
  date: DateArg<Date> & {},
  formatString: DateFormats,
) {
  return format(date, formatString)
}

export const getMidnightForDate = (date: Date) =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )

export const parseIsoDateString = (dateString: string) =>
  parse(dateString, DateFormats.isoDate, new Date())

/**
 * Parses 'YYYY-MM-DD' as UTC midnight. Use this when downstream code reads
 * the Date with `getUTCMonth()` / `getUTCFullYear()` and the source value
 * is a calendar date with no wall-clock-time intent — `parseIsoDateString`
 * (and `parseISO` directly) interpret bare 'YYYY-MM-DD' as LOCAL midnight,
 * which causes month/year wrap-around on servers east of UTC (e.g. local
 * 2026-01-01 → UTC 2025-12-31). Inputs that already carry a TZ offset are
 * passed through unchanged.
 */
export const parseIsoDateAsUTC = (dateString: string): Date =>
  ISO_DATE_ONLY_RE.test(dateString)
    ? parseISO(`${dateString}T00:00:00Z`)
    : parseISO(dateString)

export const isDateTodayOrFuture = (
  dateString: string | undefined | null,
  today: Date = startOfDay(new Date()),
): boolean => {
  if (!dateString) return false
  const date = parseIsoDateString(dateString)
  if (!isValid(date)) return false
  return !isBefore(startOfDay(date), today)
}

export const getDateRangeWithDefaults = (
  startDate?: Date,
  endDate?: Date,
  defaultDaysBack: number = 6,
) => {
  return {
    startDate: startDate
      ? startOfDay(startDate)
      : startOfDay(subDays(new Date(), defaultDaysBack)),
    endDate: endDate ? endOfDay(endDate) : endOfDay(new Date()),
  }
}
