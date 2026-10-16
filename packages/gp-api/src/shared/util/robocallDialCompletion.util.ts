import {
  addDays,
  addMinutes,
  differenceInMinutes,
  isBefore,
  max,
} from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import {
  DAILY_START_TIME,
  DAILY_STOP_TIME,
  SCHEDULE_TZ,
} from './robocallDialWindow.const'

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

// The first instant at or after `candidate` that actually falls inside the daily
// dial window: a before-open candidate waits to open, an at-or-after-close one
// waits to the next day's open, an in-window one is unchanged. The effective
// dial-START instant, so a run whose pool frees after 21:00 is projected to
// start the next morning rather than at the (closed-window) free instant.
const nextDialableInstant = (candidate: Date, timeZone: string): Date => {
  const { opensAt, closesAt } = windowBoundsForDay(candidate, timeZone)
  if (isBefore(candidate, opensAt)) return opensAt
  if (!isBefore(candidate, closesAt)) return nextDayOpen(candidate, timeZone)
  return candidate
}

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

interface DialCeilingParams {
  audienceSize: number
  callsPerMinute: number
  startAt: Date
  bufferMinutes: number
  timeZone?: string
}

/**
 * The instant a run is SURELY done dialing: the raw window-walked completion
 * estimate plus a flat buffer. The same money-safe ceiling the send sweep's
 * free-and-advance step frees a run at — `callsPerMinute` is expected to be the
 * rate-haircut (safe) rate and `bufferMinutes` the configured flat buffer, so a
 * caller gets the identical instant the queue actually advances the pool at.
 */
export const robocallDialCeilingAt = ({
  audienceSize,
  callsPerMinute,
  startAt,
  bufferMinutes,
  timeZone = SCHEDULE_TZ,
}: DialCeilingParams): Date =>
  addMinutes(
    estimateRobocallDialCompletion({
      audienceSize,
      callsPerMinute,
      startAt,
      timeZone,
    }),
    bufferMinutes,
  )

interface QueuedDialRun {
  outreachId: number
  audienceSize: number
  // The run's scheduled send instant (`Outreach.date`).
  scheduledAt: Date
  // The rate-haircut (safe) calls-per-minute THIS run dials at — derived from the
  // rate it was STAGED at, so a run staged slow keeps its longer projection even
  // after the live rate is raised for newer campaigns.
  callsPerMinute: number
}

interface ProjectedDialRun {
  outreachId: number
  scheduledAt: Date
  // When the serial queue is projected to actually START dialing this run.
  projectedStartAt: Date
  // True when the projected start lands on a LATER local calendar day than the
  // scheduled send — the backlog has pushed the send past its desired day.
  delayedPastScheduledDay: boolean
}

interface ProjectDialQueueParams {
  now: Date
  // When the shared CallHub pool first becomes free: the latest projected dial
  // completion of any in-flight run, floored at `now` (an idle queue passes
  // `now`).
  poolAvailableAt: Date
  // The waiting runs in dial order — oldest-due first (scheduledAt asc, then
  // outreachId asc), the SAME total order the serial send sweep launches in.
  // Each carries its own staged (haircut) rate.
  queue: QueuedDialRun[]
  bufferMinutes: number
  timeZone?: string
}

const localDay = (instant: Date, timeZone: string): string =>
  formatInTimeZone(instant, timeZone, LOCAL_DAY_FORMAT)

/**
 * Projects when each waiting robocall will actually dial through the strictly
 * serial queue, so a proactive alert can fire BEFORE a backlog pushes a send
 * past its scheduled day (distinct from the overdue alert, which fires only
 * once a send is already late). The pool frees one run at a time at the same
 * money-safe ceiling the send sweep advances at, so each run starts at
 * max(pool-free, its own schedule) and the next run waits on this run's
 * projected completion. A run is flagged delayed when its projected start lands
 * on a later local day than its scheduled send.
 */
export const projectRobocallDialQueue = ({
  now,
  poolAvailableAt,
  queue,
  bufferMinutes,
  timeZone = SCHEDULE_TZ,
}: ProjectDialQueueParams): ProjectedDialRun[] => {
  let poolFreeAt = max([now, poolAvailableAt])
  return queue.map((run) => {
    // The effective dial start: when the pool frees or the run is scheduled
    // (whichever is later), rolled to the next window open if that lands outside
    // the daily dial window — a run whose pool frees at 22:00 dials next morning.
    const projectedStartAt = nextDialableInstant(
      max([poolFreeAt, run.scheduledAt]),
      timeZone,
    )
    // The day the run would dial with a FREE pool (its own schedule, window-
    // rolled). Comparing against this — not the raw scheduled instant —
    // attributes a day slip to the BACKLOG only: a run scheduled after the daily
    // window closes always dials the next morning regardless, which is the run's
    // own scheduling, not something the queue backlog caused.
    const baselineStartAt = nextDialableInstant(
      max([now, run.scheduledAt]),
      timeZone,
    )
    const delayedPastScheduledDay =
      localDay(projectedStartAt, timeZone) > localDay(baselineStartAt, timeZone)
    poolFreeAt = robocallDialCeilingAt({
      audienceSize: run.audienceSize,
      callsPerMinute: run.callsPerMinute,
      startAt: projectedStartAt,
      bufferMinutes,
      timeZone,
    })
    return {
      outreachId: run.outreachId,
      scheduledAt: run.scheduledAt,
      projectedStartAt,
      delayedPastScheduledDay,
    }
  })
}
