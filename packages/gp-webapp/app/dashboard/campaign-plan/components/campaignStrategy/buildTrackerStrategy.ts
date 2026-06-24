import { differenceInDays, startOfDay } from 'date-fns'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import type {
  CampaignStrategyData,
  CampaignStrategyPhase,
  CampaignStrategyPhaseKey,
  CampaignStrategyPhaseStatus,
  CampaignStrategyTask,
  TaskChannel,
} from './campaignStrategy.types'

// Builds the render shape from persisted `campaign_tracker_tasks` rows (the new
// table) instead of the client-side catalog. Dates/phases/completion already
// live on the rows, so this only buckets by phase and applies the deterministic
// display rules (GOTV 30-day window, Active/GOTV weekly cap with progressive
// reveal, "Do this next"). The catalog builder (buildCampaignStrategy) stays the
// fallback for campaigns with no rows yet.

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

const WEEKLY_LIMIT = 3
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

const toRenderTask = (row: CampaignTrackerTask): CampaignStrategyTask => ({
  id: row.id,
  title: row.title,
  description: row.description,
  channel: toChannel(row.flowType),
  date: row.date,
  param: null,
  href: row.link,
  hrefLabel: row.link ? 'Open' : null,
  priorityTier: 'P2',
  proRequired: row.proRequired ?? false,
  status: 'live',
  unlocksAfter: null,
  isNext: false,
  completed: row.completed,
})

const dateValue = (task: CampaignStrategyTask): number =>
  task.date ? new Date(task.date).getTime() : Infinity

const compareTasks = (
  a: CampaignStrategyTask,
  b: CampaignStrategyTask,
): number => dateValue(a) - dateValue(b)

const derivePhaseStatuses = (
  phaseLatestDate: Map<CampaignStrategyPhaseKey, number | null>,
  today: Date,
): Map<CampaignStrategyPhaseKey, CampaignStrategyPhaseStatus> => {
  const startOfToday = startOfDay(today).getTime()
  const order = PHASE_META.map((p) => p.key)
  const isDone = (key: CampaignStrategyPhaseKey): boolean => {
    const latest = phaseLatestDate.get(key)
    return latest != null && latest < startOfToday
  }
  const currentIndex = order.findIndex((key) => !isDone(key))
  const current = currentIndex === -1 ? order.length - 1 : currentIndex
  const out = new Map<CampaignStrategyPhaseKey, CampaignStrategyPhaseStatus>()
  order.forEach((key, i) => {
    out.set(key, i < current ? 'done' : i === current ? 'active' : 'upcoming')
  })
  return out
}

export const buildTrackerStrategy = (
  tasks: CampaignTrackerTask[],
  {
    electionDate,
    today = new Date(),
  }: { electionDate: Date | null; today?: Date },
): CampaignStrategyData => {
  const byPhase = new Map<CampaignStrategyPhaseKey, CampaignStrategyTask[]>()
  for (const row of tasks) {
    const phase = (
      row.phase && PHASE_KEYS.has(row.phase) ? row.phase : 'preLaunch'
    ) as CampaignStrategyPhaseKey
    const list = byPhase.get(phase) ?? []
    list.push(toRenderTask(row))
    byPhase.set(phase, list)
  }

  const phaseLatestDate = new Map<CampaignStrategyPhaseKey, number | null>()
  const phases: CampaignStrategyPhase[] = PHASE_META.map((meta) => {
    const phaseTasks = (byPhase.get(meta.key) ?? []).sort(compareTasks)
    const dates = phaseTasks
      .map((t) => (t.date ? dateValue(t) : null))
      .filter((v): v is number => v != null && Number.isFinite(v))
    phaseLatestDate.set(meta.key, dates.length ? Math.max(...dates) : null)
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

  const statuses = derivePhaseStatuses(phaseLatestDate, today)
  for (const phase of phases) {
    phase.status = statuses.get(phase.key) ?? 'upcoming'
  }

  const activePhase = phases.find((p) => p.status === 'active')
  if (activePhase) {
    const candidates = activePhase.groups
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
      continue
    }

    if (phase.key === 'active' || phase.key === 'gotv') {
      const flat = phase.groups.flatMap((g) => g.tasks).sort(compareTasks)
      const completedCount = flat.filter((t) => t.completed).length
      // Progressive reveal: show the next WEEKLY_LIMIT to do plus every task
      // already completed; the rest stay hidden until the candidate works
      // through these. Surface the withheld count so the UI can say so.
      const limit = WEEKLY_LIMIT + completedCount
      phase.groups = [
        { key: 'thisWeek', label: '', tasks: flat.slice(0, limit) },
      ]
      phase.hiddenCount = Math.max(0, flat.length - limit)
    }
  }

  return { phases }
}
