import { differenceInDays, format, startOfDay, startOfWeek } from 'date-fns'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import type {
  CampaignStrategyData,
  CampaignStrategyPhase,
  CampaignStrategyPhaseKey,
  CampaignStrategyPhaseStatus,
  CampaignStrategyTask,
  CampaignStrategyWeek,
  TaskChannel,
} from './campaignStrategy.types'

// Builds the render shape from persisted `campaign_tracker_tasks` rows. Dates,
// phases, and completion already live on the rows, so this only buckets by phase
// and applies the deterministic display rules: the GOTV 30-day window gate, the
// Active phase's Monday-Sunday week navigator (one week at a time, see
// buildActiveWeeks), and "Do this next".

const PHASE_META: {
  key: CampaignStrategyPhaseKey
  title: string
  summary: string
}[] = [
  {
    key: 'preLaunch',
    title: 'Pre-launch',
    summary: 'Ballot access and campaign setup.',
  },
  {
    key: 'launch',
    title: 'Launch',
    summary: 'Introduce yourself to voters across every channel.',
  },
  {
    key: 'active',
    title: 'Active campaign',
    summary: 'Identify your supporters, then persuade the undecideds.',
  },
  {
    key: 'gotv',
    title: 'Get out the vote',
    summary: 'Push your supporters to actually vote.',
  },
]

const GOTV_WINDOW_DAYS = 30

const FLOW_TYPE_TO_CHANNEL: Record<string, TaskChannel> = {
  text: 'text',
  robocall: 'robocall',
  doorKnocking: 'doorKnocking',
  phoneBanking: 'phoneBanking',
  events: 'event',
  awareness: 'awareness',
}

const PHASE_KEYS = new Set<string>(PHASE_META.map((p) => p.key))

const toChannel = (flowType: string | null): TaskChannel =>
  (flowType && FLOW_TYPE_TO_CHANNEL[flowType]) || 'general'

// Text/robocall rows carry no link of their own; route them to the outreach
// compose deep link with the task's due date attached, so the flow opens
// pre-bound to the task and the due date reaches the outreach record (and its
// Slack notification) — matching what the legacy task list did.
const OUTREACH_COMPOSE_CHANNELS = new Set<TaskChannel>(['text', 'robocall'])

const outreachComposeHref = (
  channel: TaskChannel,
  date: string | null,
): string =>
  `/dashboard/outreach?compose=${channel}${
    date ? `&due=${date.slice(0, 10)}` : ''
  }`

const toRenderTask = (row: CampaignTrackerTask): CampaignStrategyTask => {
  const channel = toChannel(row.flowType)
  const composeHref =
    !row.link && OUTREACH_COMPOSE_CHANNELS.has(channel)
      ? outreachComposeHref(channel, row.date)
      : null
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    channel,
    date: row.date,
    param: null,
    href: row.link ?? composeHref,
    hrefLabel: row.link ? 'Open' : composeHref ? 'Start outreach' : null,
    priorityTier: 'P2',
    proRequired: row.proRequired ?? false,
    status: 'live',
    unlocksAfter: null,
    isNext: false,
    completed: row.completed,
  }
}

// API dates are full ISO at UTC midnight; the catalog fallback is date-only.
// Parse both as LOCAL midnight (slice + dash->slash, matching the date chip in
// CampaignStrategyTaskRow) so week bucketing lines up with what the row shows —
// a raw `new Date(isoUtc)` shifts to the previous day in US timezones and would
// land the task in the wrong calendar week.
const localMidnight = (date: string): Date =>
  new Date(date.slice(0, 10).replace(/-/g, '/'))

const dateValue = (task: CampaignStrategyTask): number =>
  task.date ? localMidnight(task.date).getTime() : Infinity

const compareTasks = (
  a: CampaignStrategyTask,
  b: CampaignStrategyTask,
): number => dateValue(a) - dateValue(b)

const derivePhaseStatuses = (
  phaseLatestDate: Map<CampaignStrategyPhaseKey, number | null>,
  phaseAllCompleted: Map<CampaignStrategyPhaseKey, boolean>,
  today: Date,
): Map<CampaignStrategyPhaseKey, CampaignStrategyPhaseStatus> => {
  const startOfToday = startOfDay(today).getTime()
  const order = PHASE_META.map((p) => p.key)
  // "Happening now" is date-driven: the first phase the calendar has reached
  // that still has work. A phase with no tasks (null latest date) is skipped so
  // an empty intermediate phase can't halt the scan and strand a later,
  // genuinely-current phase as 'upcoming'; a phase entirely in the past is
  // skipped too. Completion is a separate axis — a phase reads 'done' only when
  // every task in it is checked off, not merely because its dates elapsed, so a
  // phase at or before "now" with open tasks stays 'active' and future phases
  // are 'upcoming' until reached.
  const isCurrentlyInPlay = (key: CampaignStrategyPhaseKey): boolean => {
    const latest = phaseLatestDate.get(key)
    return latest != null && latest >= startOfToday
  }
  const nowIndex = order.findIndex(isCurrentlyInPlay)
  let current = nowIndex === -1 ? order.length - 1 : nowIndex
  // Completion advances "now" past the calendar: when the calendar-current
  // phase (and any phases after it) are fully checked off, the first phase
  // with open work becomes current — so finishing every pre-launch task flips
  // Launch to 'active' instead of stranding it at 'upcoming' until its dates
  // arrive.
  while (current < order.length - 1) {
    const key = order[current]
    if (!key || !phaseAllCompleted.get(key)) break
    current += 1
  }
  const out = new Map<CampaignStrategyPhaseKey, CampaignStrategyPhaseStatus>()
  order.forEach((key, i) => {
    const status: CampaignStrategyPhaseStatus = phaseAllCompleted.get(key)
      ? 'done'
      : i <= current
        ? 'active'
        : 'upcoming'
    out.set(key, status)
  })
  return out
}

const phaseOf = (task: CampaignTrackerTask): CampaignStrategyPhaseKey =>
  (task.phase && PHASE_KEYS.has(task.phase)
    ? task.phase
    : 'preLaunch') as CampaignStrategyPhaseKey

// The active phase renders as a week navigator: one Monday-Sunday week at a
// time. Group every active-phase task (the deterministic outreach + all dynamic
// generations) by its calendar week. Each weekly regen lands as its own week;
// if two generations ever fall in the same calendar week (a same-week re-run),
// keep the latest. The week containing today is flagged so the UI opens there.
const buildActiveWeeks = (
  tasks: CampaignTrackerTask[],
  today: Date,
): CampaignStrategyWeek[] => {
  const active = tasks.filter((t) => phaseOf(t) === 'active' && t.date)
  if (active.length === 0) return []

  const byWeek = new Map<number, CampaignTrackerTask[]>()
  for (const task of active) {
    const weekStart = startOfWeek(localMidnight(task.date), {
      weekStartsOn: 1,
    }).getTime()
    byWeek.set(weekStart, [...(byWeek.get(weekStart) ?? []), task])
  }

  const todayWeek = startOfWeek(startOfDay(today), {
    weekStartsOn: 1,
  }).getTime()

  return [...byWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([weekMs, rows]) => {
      // Within a calendar week the dynamic rows keep only the latest generation;
      // the deterministic outreach (isDefaultTask) always shows.
      const latestGen = rows
        .filter((r) => !r.isDefaultTask)
        .reduce((max, r) => Math.max(max, r.week), -Infinity)
      const tasksForWeek = rows
        .filter((r) => r.isDefaultTask || r.week === latestGen)
        .map(toRenderTask)
        .sort(compareTasks)
      const next = tasksForWeek.find((t) => !t.completed)
      if (weekMs === todayWeek && next) next.isNext = true
      return {
        start: format(new Date(weekMs), 'yyyy-MM-dd'),
        tasks: tasksForWeek,
        isCurrent: weekMs === todayWeek,
      }
    })
}

export const buildTrackerStrategy = (
  tasks: CampaignTrackerTask[],
  {
    electionDate,
    today = new Date(),
  }: { electionDate: Date | null; today?: Date },
): CampaignStrategyData => {
  // Weekly regen appends each run as a new `week` generation; older ones
  // persist (completion history + prior-task dedupe via MCP) but only the
  // latest dynamic generation renders. Static rows (isDefaultTask) always show.
  const dynamicWeeks = tasks.filter((t) => !t.isDefaultTask).map((t) => t.week)
  const latestGen = dynamicWeeks.length ? Math.max(...dynamicWeeks) : null
  const visibleTasks =
    latestGen === null
      ? tasks
      : tasks.filter((t) => t.isDefaultTask || t.week === latestGen)

  const byPhase = new Map<CampaignStrategyPhaseKey, CampaignStrategyTask[]>()
  for (const row of visibleTasks) {
    const phase = (
      row.phase && PHASE_KEYS.has(row.phase) ? row.phase : 'preLaunch'
    ) as CampaignStrategyPhaseKey
    const list = byPhase.get(phase) ?? []
    list.push(toRenderTask(row))
    byPhase.set(phase, list)
  }

  const phaseLatestDate = new Map<CampaignStrategyPhaseKey, number | null>()
  const phaseAllCompleted = new Map<CampaignStrategyPhaseKey, boolean>()
  const phases: CampaignStrategyPhase[] = PHASE_META.map((meta) => {
    const phaseTasks = (byPhase.get(meta.key) ?? []).sort(compareTasks)
    const dates = phaseTasks
      .map((t) => (t.date ? dateValue(t) : null))
      .filter((v): v is number => v != null && Number.isFinite(v))
    phaseLatestDate.set(meta.key, dates.length ? Math.max(...dates) : null)
    phaseAllCompleted.set(
      meta.key,
      phaseTasks.length > 0 && phaseTasks.every((t) => t.completed),
    )
    return {
      key: meta.key,
      title: meta.title,
      summary: meta.summary,
      status: 'upcoming' as CampaignStrategyPhaseStatus,
      groups: phaseTasks.length
        ? [{ key: 'all', label: '', tasks: phaseTasks }]
        : [],
    }
  })

  const statuses = derivePhaseStatuses(
    phaseLatestDate,
    phaseAllCompleted,
    today,
  )
  for (const phase of phases) {
    phase.status = statuses.get(phase.key) ?? 'upcoming'
  }

  // The Active phase renders as a week navigator built from every generation
  // (not just the latest), so its flat group list is replaced by `weeks`.
  const activeKeyPhase = phases.find((p) => p.key === 'active')
  if (activeKeyPhase) {
    const activeWeeks = buildActiveWeeks(tasks, today)
    activeKeyPhase.weeks = activeWeeks
    activeKeyPhase.groups = []
    // phaseAllCompleted came from visibleTasks (the global latest generation),
    // but the navigator renders per-week-latest tasks across all generations. A
    // prior generation's open task can still be navigable, so re-check 'done'
    // against everything the navigator can show; otherwise the header reads
    // 'done' while open tasks sit one week back.
    if (activeKeyPhase.status === 'done') {
      const navigableTasks = activeWeeks.flatMap((w) => w.tasks)
      const allDone =
        navigableTasks.length > 0 && navigableTasks.every((t) => t.completed)
      if (!allDone) activeKeyPhase.status = 'active'
    }
  }

  // "Do this next" on the phase the calendar has reached. The Active phase marks
  // its own (the current week's first open task, in buildActiveWeeks), so only
  // a different "happening now" phase (e.g. Pre-launch early on) needs it here.
  const happeningNow = phases.find((p) => p.status === 'active')
  if (happeningNow && happeningNow.key !== 'active') {
    const candidates = happeningNow.groups
      .flatMap((g) => g.tasks)
      .filter((t) => !t.completed)
      .sort(compareTasks)
    if (candidates[0]) candidates[0].isNext = true
  }

  const daysToElection = electionDate
    ? differenceInDays(electionDate, startOfDay(today))
    : null

  for (const phase of phases) {
    if (
      phase.key === 'gotv' &&
      (daysToElection == null || daysToElection > GOTV_WINDOW_DAYS)
    ) {
      const inDays =
        daysToElection != null ? daysToElection - GOTV_WINDOW_DAYS : null
      phase.gate = {
        kind: 'window',
        message:
          inDays != null
            ? `Your get-out-the-vote push begins about ${GOTV_WINDOW_DAYS} days before election day, roughly ${inDays} day${inDays === 1 ? '' : 's'} from now. Your GOTV tasks will appear here then.`
            : `Your get-out-the-vote tasks appear here in the final ${GOTV_WINDOW_DAYS} days before election day.`,
      }
      phase.groups = []
    }
  }

  return { phases }
}
