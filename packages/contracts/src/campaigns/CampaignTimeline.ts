import { CAMPAIGN_TASK_CATALOG } from './CampaignTaskCatalog.data'
import { VOTER_CONTACT_SCHEDULE } from './VoterContactSchedule.data'
import type {
  CampaignStrategyPhaseKey,
  TaskTiming,
} from './CampaignTaskCatalog.schema'

// The campaign as a timeline: three phases that are windows on the calendar,
// counted back from election day and forward from when the plan started. A
// task's phase is the window its date falls in, so the plan's phases are
// time, not a kind of task. Shared so gp-api dates tasks and the webapp
// groups them by the same windows.
//
// Launch covers everything before the campaign is in front of voters: the
// setup work first, then going public. The catalog still says whether a task
// is pre-launch or launch work, which places it early or late in Launch.

const DAY_MS = 24 * 60 * 60 * 1000

// Get-out-the-vote is the final stretch before election day.
export const GOTV_WINDOW_DAYS = 30
// The active campaign opens about ten weeks out.
export const ACTIVE_WEEKS_BEFORE_ELECTION = 10
// Launch gets at least four weeks, unless the race is too close for it.
const MIN_LAUNCH_DAYS = 28
// Going public happens in Launch's last two weeks.
const GOING_PUBLIC_DAYS = 14

export type CampaignTimelinePhase = 'launch' | 'active' | 'gotv'

// Where each phase begins. Launch runs from `start` to `active`, the active
// campaign to `gotv`, and get-out-the-vote from `gotv` on.
export interface CampaignPhaseWindows {
  start: Date
  active: Date
  gotv: Date
  election: Date | null
}

const plusDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * DAY_MS)
const earlier = (a: Date, b: Date): Date => (a < b ? a : b)
const later = (a: Date, b: Date): Date => (a > b ? a : b)

// A candidate who joins late gets a compressed timeline rather than a fake
// one: Launch shrinks to half the time left before get-out-the-vote (never
// past four weeks), and a phase with no room left is zero length. One who
// joins with the election inside 30 days is in get-out-the-vote from the
// start.
// The election a campaign's timeline counts back from: the general, falling
// back to the primary, skipping whichever is already behind `today` (a
// YYYY-MM-DD calendar day). gp-api dates tasks with it and the webapp builds
// the phase windows with it, so a task's date and the phase it shows in come
// from the same election. A past date anchors nothing: a returning candidate
// keeps last cycle's election until they update their race.
export const timelineElectionDate = (
  dates: { general?: string | null; primary?: string | null },
  today: string,
): string | null =>
  [dates.general, dates.primary].find(
    (date): date is string => !!date && date.slice(0, 10) >= today,
  ) ?? null

export const campaignPhaseWindows = (
  start: Date,
  election: Date | null,
): CampaignPhaseWindows => {
  if (!election) {
    // Nothing to count back from: Launch for four weeks, then the active
    // campaign, and get-out-the-vote is never reached.
    return {
      start,
      active: plusDays(start, MIN_LAUNCH_DAYS),
      gotv: new Date(8.64e15),
      election,
    }
  }
  const gotv = later(start, plusDays(election, -GOTV_WINDOW_DAYS))
  const roomDays = (gotv.getTime() - start.getTime()) / DAY_MS
  // Whole days, so every phase boundary is a midnight like the task dates.
  const earliestActive = plusDays(
    start,
    Math.min(MIN_LAUNCH_DAYS, Math.floor(roomDays / 2)),
  )
  const active = earlier(
    later(
      plusDays(election, -ACTIVE_WEEKS_BEFORE_ELECTION * 7),
      earliestActive,
    ),
    gotv,
  )
  return { start, active, gotv, election }
}

// The catalog's pre-launch and launch both live in Launch now.
export const timelinePhase = (
  phase: CampaignStrategyPhaseKey | string | null,
): CampaignTimelinePhase =>
  phase === 'active' ? 'active' : phase === 'gotv' ? 'gotv' : 'launch'

export const phaseStart = (
  windows: CampaignPhaseWindows,
  phase: CampaignStrategyPhaseKey,
): Date => {
  const key = timelinePhase(phase)
  return key === 'launch'
    ? windows.start
    : key === 'active'
      ? windows.active
      : windows.gotv
}

export const phaseForDate = (
  windows: CampaignPhaseWindows,
  date: Date,
): CampaignTimelinePhase =>
  date < windows.active ? 'launch' : date < windows.gotv ? 'active' : 'gotv'

// When each of the plan's voter-contact sends goes out. A send still ahead
// when the plan starts keeps its date, counted back from the election. A
// late joiner's sends that were already past move up, in order, into the time
// before the next send still ahead (or election day): the first on the start
// day, then a week apart, closer if there isn't room, and never closer than a
// day while there are days to use. With fewer days than sends, the latest
// sends keep a day each and the oldest share the start day; with no day at
// all they all land on it. Shared by the tracker and the plan document, so
// they never disagree.
export const voterContactSendDate = (
  catalogId: string,
  election: Date,
  start: Date,
): Date | null => {
  const sends = VOTER_CONTACT_SCHEDULE.map((send) => ({
    id: send.catalogId as string,
    date: plusDays(election, -send.daysBeforeElection),
  }))
  const send = sends.find((candidate) => candidate.id === catalogId)
  if (!send) return null
  const past = sends.filter((candidate) => candidate.date < start)
  const index = past.findIndex((candidate) => candidate.id === catalogId)
  if (index === -1) return send.date
  const next =
    sends.find((candidate) => candidate.date >= start)?.date ?? election
  const roomDays = Math.floor((next.getTime() - start.getTime()) / DAY_MS)
  if (roomDays >= past.length) {
    const stepDays = Math.min(7, Math.floor(roomDays / past.length))
    return plusDays(start, index * stepDays)
  }
  // One a day from the end, so the sends that crowd onto the start day are
  // the oldest, the ones least worth sending this late.
  return plusDays(start, Math.max(0, index - (past.length - roomDays)))
}

// The date a catalog task gets on the timeline. Election-relative work is
// dated from the election, as before. Setup work lands early in Launch and
// going-public work in its last two weeks, rather than a fixed number of
// days after signup. Work with no knowable date (a state deadline, per-item
// or recurring work) is planned for the start of its phase.
export const resolveTrackerTaskDate = (
  task: { id?: string; timing: TaskTiming; phase: CampaignStrategyPhaseKey },
  windows: CampaignPhaseWindows,
): Date => {
  const { timing } = task
  const { start, active, election } = windows
  // The voter-contact sends follow their own schedule, compressed for a late
  // joiner rather than dated before the plan began.
  const send =
    task.id && election ? voterContactSendDate(task.id, election, start) : null
  if (send) return send
  // The last day of Launch, for work that has to land inside it.
  const lastLaunchDay = later(start, plusDays(active, -1))
  switch (timing.kind) {
    case 'asap':
    case 'onboardingWeek':
      return start
    case 'preLaunch':
      return earlier(plusDays(start, 7), lastLaunchDay)
    case 'launch':
      return earlier(
        later(plusDays(start, 14), plusDays(active, -GOING_PUBLIC_DAYS)),
        lastLaunchDay,
      )
    case 'electionRelative':
      if (!election) return start
      return plusDays(
        election,
        -(timing.unit === 'weeks' ? timing.offset * 7 : timing.offset),
      )
    case 'electionDay':
      return election ?? start
    case 'afterElection':
      return election ? plusDays(election, timing.weeks * 7) : start
    case 'jurisdiction':
    case 'recurring':
    case 'perItem':
      return phaseStart(windows, task.phase)
  }
}

// The day the timeline starts, read back from a campaign's default rows: the
// date of its "do this first" work, which is always dated at the start.
// Falls back to the earliest default date when none of those exist.
export const trackerTimelineStart = (
  rows: {
    title: string
    date: string | Date
    isDefaultTask: boolean | null
  }[],
): Date | null => {
  const asapTitles = new Set(
    CAMPAIGN_TASK_CATALOG.filter(
      (task) =>
        task.timing.kind === 'asap' || task.timing.kind === 'onboardingWeek',
    ).map((task) => task.title),
  )
  const defaults = rows.filter((row) => row.isDefaultTask)
  const anchors = defaults.filter((row) => asapTitles.has(row.title))
  const times = (anchors.length > 0 ? anchors : defaults).map((row) =>
    new Date(row.date).getTime(),
  )
  return times.length > 0 ? new Date(Math.min(...times)) : null
}
