import { addDays, isBefore, parseISO } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { rrulestr } from 'rrule'
import { DateFormats } from '@/shared/util/date.util'
import { resolveSendWindowTimeZone } from '@/shared/util/sendWindowTimeZone.util'

export type MeetingOnDay = {
  meetingDate: string
  meetingTime: string
}

// The state table answers in Peerly's "US/Central" spelling. The schedule
// agent names zones the tz-database way, so a zone picked from a state reads
// the same as one a schedule found.
const TZ_DATABASE_NAMES: Record<string, string> = {
  'US/Eastern': 'America/New_York',
  'US/Central': 'America/Chicago',
  'US/Mountain': 'America/Denver',
  'US/Arizona': 'America/Phoenix',
  'US/Pacific': 'America/Los_Angeles',
  'US/Alaska': 'America/Anchorage',
  'US/Hawaii': 'Pacific/Honolulu',
}

/** The predominant zone of a state, Eastern when the state is unknown. */
export const stateTimezone = (state: string | null | undefined): string => {
  const zone = resolveSendWindowTimeZone(state)
  return TZ_DATABASE_NAMES[zone] ?? zone
}

/** The calendar day (yyyy-MM-dd) it is at `instant` on a clock in `timezone`. */
export const dayInZone = (instant: Date, timezone: string): string =>
  formatInTimeZone(instant, timezone, DateFormats.isoDate)

// Noon keeps the arithmetic clear of the server's own daylight-saving shifts,
// which would otherwise move a midnight onto the day before.
export const shiftDay = (day: string, days: number): string =>
  formatInTimeZone(
    addDays(parseISO(`${day}T12:00:00Z`), days),
    'UTC',
    DateFormats.isoDate,
  )

/** The moment a meeting starts: its day and time read on its own clock. */
export const meetingStart = (meeting: MeetingOnDay, timezone: string): Date =>
  fromZonedTime(`${meeting.meetingDate}T${meeting.meetingTime}:00`, timezone)

/**
 * The days a recurrence lands on from `fromDay` through `toDay`, all on the
 * meeting's own clock. rrule works in floating time (a wall clock it holds as
 * UTC), so the bounds are days, never instants: comparing its dates with a
 * real instant reads a 7 pm meeting as 7 pm UTC. Throws on a rule rrule
 * cannot parse.
 */
export const recurrenceDays = (
  schedule: { rrule: string; time: string },
  fromDay: string,
  toDay: string,
): string[] =>
  rrulestr(
    `DTSTART:${fromDay.replaceAll('-', '')}T${schedule.time.replace(':', '')}00\nRRULE:${schedule.rrule}`,
  )
    .between(
      parseISO(`${fromDay}T00:00:00Z`),
      parseISO(`${toDay}T23:59:59Z`),
      true,
    )
    .map((occurrence) =>
      formatInTimeZone(occurrence, 'UTC', DateFormats.isoDate),
    )

/**
 * The upcoming meetings inside a window of `windowDays`: each has not started
 * at `now`, and falls on or before the day `windowDays` after today. Both
 * days are read in `timezone`, so "three days before" means three calendar
 * days on the meeting's own clock whatever hour the caller runs at.
 *
 * `scheduled` is what the schedule projects. A `stated` first meeting (the one
 * the official gave) replaces a scheduled meeting on its day and removes the
 * scheduled ones before it, until its own day has passed.
 */
export const meetingsInWindow = (args: {
  scheduled: MeetingOnDay[]
  stated: MeetingOnDay | null
  timezone: string
  now: Date
  windowDays: number
}): MeetingOnDay[] => {
  const { scheduled, timezone, now, windowDays } = args
  const today = dayInZone(now, timezone)
  const lastDay = shiftDay(today, windowDays)
  const stated =
    args.stated && args.stated.meetingDate >= today ? args.stated : null
  const merged = stated
    ? [
        ...scheduled.filter(
          (meeting) => meeting.meetingDate > stated.meetingDate,
        ),
        stated,
      ]
    : scheduled
  return merged
    .filter(
      (meeting) =>
        meeting.meetingDate <= lastDay &&
        !isBefore(meetingStart(meeting, timezone), now),
    )
    .sort((a, b) => a.meetingDate.localeCompare(b.meetingDate))
}
