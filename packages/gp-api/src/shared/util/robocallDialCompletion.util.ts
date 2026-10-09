import { addDays, addMinutes, differenceInMinutes, isBefore } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

// CallHub only dials inside a daily local window; these mirror the schedule
// config createVoiceBroadcast sends to CallHub (daily_start_time /
// daily_stop_time / timezone in vendors/callhub/services/callhubCampaign
// .service.ts). CallHub enforces this same window at dial time, so an estimate
// walked over these bounds is an estimate of the real run — keep them in sync.
export const DAILY_START_TIME = '09:00'
export const DAILY_STOP_TIME = '21:00'
export const SCHEDULE_TZ = 'America/Chicago'

const LOCAL_DAY_FORMAT = 'yyyy-MM-dd'

interface EstimateDialCompletionParams {
  audienceSize: number
  callsPerMinute: number
  startAt: Date
  // v1 assumes ONE timezone for the whole audience: the campaign's schedule
  // zone. CallHub's use_contact_tz actually applies the daily window in each
  // contact's OWN zone, so a national list spreads 9am Eastern through 9pm
  // Pacific and dials across a window three hours wider than a single zone —
  // finishing sooner than this single-zone walk predicts. Modeling that
  // per-zone spread is a future refinement; do not build it here.
  timeZone?: string
}

// The DAILY_START_TIME / DAILY_STOP_TIME instants for the local calendar day
// that `instant` falls on. DST-safe: formatInTimeZone reads the wall-clock day
// and fromZonedTime re-anchors each bound in the zone (the window never
// straddles the 2am transition, so it is always a full 12h).
const windowBoundsForDay = (instant: Date, timeZone: string) => {
  const localDay = formatInTimeZone(instant, timeZone, LOCAL_DAY_FORMAT)
  return {
    opensAt: fromZonedTime(`${localDay} ${DAILY_START_TIME}:00`, timeZone),
    closesAt: fromZonedTime(`${localDay} ${DAILY_STOP_TIME}:00`, timeZone),
  }
}

// The next calendar day's open instant. addDays lands on the following day
// regardless of DST, then the open bound is re-anchored from that day.
const nextDayOpen = (instant: Date, timeZone: string): Date =>
  windowBoundsForDay(addDays(instant, 1), timeZone).opensAt

/**
 * Estimates the instant a robocall campaign finishes DIALING, from its audience
 * size, dial rate, and start time. CallHub reports no progress signal, so the
 * serial-send queue (future phases) needs this up-front estimate to know when a
 * campaign frees the shared account pool for the next one.
 *
 * Raw dialing-minutes = ceil(audienceSize / callsPerMinute); max retries is 0,
 * so there is one call per contact and no retry multiplier. The walk counts
 * ONLY minutes inside the daily 09:00-21:00 local window: a start before 09:00
 * waits to open, a start at or after 21:00 waits to the next day's open, and a
 * run that spills past 21:00 resumes at the next open.
 *
 * Returns the RAW completion instant. Callers add their own conservative buffer
 * downstream (a future phase); none is baked in here.
 */
export const estimateRobocallDialCompletion = ({
  audienceSize,
  callsPerMinute,
  startAt,
  timeZone = SCHEDULE_TZ,
}: EstimateDialCompletionParams): Date => {
  if (audienceSize <= 0) {
    throw new RangeError('audienceSize must be a positive number')
  }
  if (callsPerMinute <= 0) {
    throw new RangeError('callsPerMinute must be a positive number')
  }
  let remainingMinutes = Math.ceil(audienceSize / callsPerMinute)
  let cursor = startAt
  while (remainingMinutes > 0) {
    const { opensAt, closesAt } = windowBoundsForDay(cursor, timeZone)
    if (isBefore(cursor, opensAt)) {
      cursor = opensAt
      continue
    }
    if (!isBefore(cursor, closesAt)) {
      cursor = nextDayOpen(cursor, timeZone)
      continue
    }
    const availableMinutes = differenceInMinutes(closesAt, cursor)
    if (remainingMinutes <= availableMinutes) {
      return addMinutes(cursor, remainingMinutes)
    }
    remainingMinutes -= availableMinutes
    cursor = nextDayOpen(cursor, timeZone)
  }
  return cursor
}
