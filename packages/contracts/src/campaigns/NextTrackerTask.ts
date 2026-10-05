import type { TrackerTaskSkipReason } from '../generated/enums'
import {
  BALLOT_ACCESS_CATEGORY,
  CAMPAIGN_TASK_CATALOG,
} from './CampaignTaskCatalog.data'
import type { CampaignStrategyPhaseKey } from './CampaignTaskCatalog.schema'

// The one "next thing" a candidate should do, shared by every surface that
// shows it so they can never disagree. It is the most important open task in
// plan order, and it stays the next thing until the candidate does it, marks
// it done, skips it, or its date passes on a task that only exists on that date.

// How long "Later" keeps a task from being the next thing.
export const TRACKER_TASK_SNOOZE_DAYS = 3

// Get-out-the-vote work only opens in the final stretch before election day.
export const GOTV_WINDOW_DAYS = 30

export interface NextTrackerTaskCandidate {
  id: string
  title: string
  phase: string | null
  date: string | Date
  completed: boolean
  flowType: string | null
  isDefaultTask: boolean | null
  week: number
  skipReason: TrackerTaskSkipReason | null
  snoozedUntil: string | Date | null
}

export interface NextTrackerTaskContext {
  // 'on-ballot' is the only answer that means the candidate has filed; every
  // other answer, and no answer, keeps ballot access at the front.
  onBallot: boolean
  electionDate: Date | null
  now: Date
}

const PHASE_ORDER: CampaignStrategyPhaseKey[] = [
  'preLaunch',
  'launch',
  'active',
  'gotv',
]

// Tracker rows carry no catalog id, so the title is the handle on the ballot
// access rows (the same handle gp-api's reconcile uses).
const BALLOT_ACCESS_TITLES = new Set(
  CAMPAIGN_TASK_CATALOG.filter(
    (task) => task.category === BALLOT_ACCESS_CATEGORY,
  ).map((task) => task.title),
)

// An event, a scheduled send, or get-out-the-vote work happens on its date, so
// once that date passes there is nothing left to do.
const TIME_BOUND_FLOW_TYPES = new Set(['events', 'text', 'robocall'])

const DAY_MS = 24 * 60 * 60 * 1000

// Task dates are stored as UTC midnight, so compare calendar days, not
// instants, or a task dated today reads as yesterday in US timezones.
const dateKey = (value: string | Date): string =>
  (typeof value === 'string' ? value : value.toISOString()).slice(0, 10)

const localDateKey = (value: Date): string => {
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

const phaseIndex = (phase: string | null): number => {
  const index = PHASE_ORDER.indexOf(phase as CampaignStrategyPhaseKey)
  return index === -1 ? 0 : index
}

export const isBallotAccessTask = (task: { title: string }): boolean =>
  BALLOT_ACCESS_TITLES.has(task.title)

export const isTimeBoundTask = (task: {
  flowType: string | null
  phase: string | null
}): boolean =>
  TIME_BOUND_FLOW_TYPES.has(task.flowType ?? '') || task.phase === 'gotv'

export const isTrackerTaskSnoozed = (
  task: { snoozedUntil: string | Date | null },
  now: Date,
): boolean =>
  task.snoozedUntil !== null &&
  new Date(task.snoozedUntil).getTime() > now.getTime()

// Weekly generation appends a new set of AI-picked rows and keeps the old ones
// for history, so only the latest set competes alongside the static rows.
const currentTasks = <T extends NextTrackerTaskCandidate>(tasks: T[]): T[] => {
  const dynamicWeeks = tasks.filter((t) => !t.isDefaultTask).map((t) => t.week)
  if (dynamicWeeks.length === 0) return tasks
  const latest = Math.max(...dynamicWeeks)
  return tasks.filter((t) => t.isDefaultTask || t.week === latest)
}

const comparePlanOrder = (
  a: NextTrackerTaskCandidate,
  b: NextTrackerTaskCandidate,
): number =>
  phaseIndex(a.phase) - phaseIndex(b.phase) ||
  dateKey(a.date).localeCompare(dateKey(b.date)) ||
  a.id.localeCompare(b.id)

export const selectNextTrackerTask = <T extends NextTrackerTaskCandidate>(
  tasks: T[],
  { onBallot, electionDate, now }: NextTrackerTaskContext,
): T | null => {
  const today = localDateKey(now)
  const gotvOpen =
    electionDate !== null &&
    (electionDate.getTime() - now.getTime()) / DAY_MS <= GOTV_WINDOW_DAYS

  const eligible = currentTasks(tasks)
    .filter(
      (task) =>
        !task.completed &&
        task.skipReason !== 'notForMe' &&
        !isTrackerTaskSnoozed(task, now) &&
        !(isTimeBoundTask(task) && dateKey(task.date) < today) &&
        !(task.phase === 'gotv' && !gotvOpen),
    )
    .sort(comparePlanOrder)

  if (!onBallot) {
    const ballotTask = eligible.find(isBallotAccessTask)
    if (ballotTask) return ballotTask
  }
  return eligible[0] ?? null
}
