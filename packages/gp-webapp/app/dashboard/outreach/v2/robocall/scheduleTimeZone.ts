import { format } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

// Robocall send times are entered and displayed in the candidate's local
// timezone — the 9am-9pm delivery window is a per-contact-timezone legal rule —
// but the instant is stored as UTC (scheduledAt). The race's own IANA timezone
// is the eventual source of truth (wired in when the schedule persists at the
// pay step); until then we derive the zone from the campaign's state. Split
// states map to their predominant zone; Eastern is the fallback for anything
// unmapped (territories, missing state).
const STATE_TIME_ZONES: Record<string, string> = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DE: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  HI: 'America/Honolulu',
  ID: 'America/Denver',
  IL: 'America/Chicago',
  IN: 'America/New_York',
  IA: 'America/Chicago',
  KS: 'America/Chicago',
  KY: 'America/New_York',
  LA: 'America/Chicago',
  ME: 'America/New_York',
  MD: 'America/New_York',
  MA: 'America/New_York',
  MI: 'America/New_York',
  MN: 'America/Chicago',
  MS: 'America/Chicago',
  MO: 'America/Chicago',
  MT: 'America/Denver',
  NE: 'America/Chicago',
  NV: 'America/Los_Angeles',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NY: 'America/New_York',
  NC: 'America/New_York',
  ND: 'America/Chicago',
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',
  TN: 'America/Chicago',
  TX: 'America/Chicago',
  UT: 'America/Denver',
  VT: 'America/New_York',
  VA: 'America/New_York',
  WA: 'America/Los_Angeles',
  WV: 'America/New_York',
  WI: 'America/Chicago',
  WY: 'America/Denver',
  DC: 'America/New_York',
}

export const DEFAULT_TIME_ZONE = 'America/New_York'

export const resolveCampaignTimeZone = (state?: string | null): string =>
  (state && STATE_TIME_ZONES[state.toUpperCase()]) || DEFAULT_TIME_ZONE

// Short zone label for display ("EDT"/"CST"…), resolved at a given instant so
// it reflects DST.
export const timeZoneShortLabel = (timeZone: string, at: Date): string =>
  new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value ?? ''

// The local Date at midnight for the calendar day `instant` falls on in the
// given zone — used to bound the day picker by candidate-tz days rather than
// browser-tz days.
export const zonedCalendarDay = (instant: Date, timeZone: string): Date => {
  const year = Number(formatInTimeZone(instant, timeZone, 'yyyy'))
  const month = Number(formatInTimeZone(instant, timeZone, 'MM'))
  const day = Number(formatInTimeZone(instant, timeZone, 'dd'))
  return new Date(year, month - 1, day)
}

// Combine a picked calendar day (local Y/M/D) and an "HH:mm" 24h slot into the
// UTC instant that wall-clock time represents in the candidate's zone. Returns
// null until both parts are chosen. fromZonedTime resolves DST correctly.
export const combineScheduledAt = (
  day: Date | undefined,
  time: string,
  timeZone: string,
): Date | null => {
  if (!day || !time) return null
  return fromZonedTime(`${format(day, 'yyyy-MM-dd')} ${time}:00`, timeZone)
}
