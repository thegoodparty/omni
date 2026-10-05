import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

// The send as CAS should read it: the candidate's calendar day and wall-clock
// time in the campaign's zone — the values Peerly books and gp-admin shows.
// Never the raw instant: the API runs in UTC, so Date.toString() on an
// evening US send names the NEXT day (a Tuesday 6 PM Pacific robocall posted
// as "Wed Oct 07", 2026-10-05).
const SCHEDULED_SEND_FORMAT = "EEE, MMM d, yyyy 'at' h:mm a zzz"

export const formatScheduledSend = ({
  date,
  scheduledLocalDate,
  scheduledLocalTime,
  timeZone,
}: {
  date: Date | null | undefined
  scheduledLocalDate: string | null | undefined
  scheduledLocalTime: string | null | undefined
  timeZone: string
}): string | undefined => {
  // A stored wall clock is what Peerly books for a text; a robocall stores
  // only the day, so its instant is the truth.
  const instant =
    scheduledLocalDate && scheduledLocalTime
      ? fromZonedTime(
          `${scheduledLocalDate}T${scheduledLocalTime}:00`,
          timeZone,
        )
      : date
  if (!instant || Number.isNaN(instant.getTime())) return undefined
  return formatInTimeZone(instant, timeZone, SCHEDULED_SEND_FORMAT)
}
