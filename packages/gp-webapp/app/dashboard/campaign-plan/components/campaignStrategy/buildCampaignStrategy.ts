import {
  addDays,
  addWeeks,
  differenceInDays,
  format,
  startOfDay,
  subDays,
  subWeeks,
} from 'date-fns'
import { CAMPAIGN_TASK_CATALOG } from '@goodparty_org/contracts'
import type {
  CampaignStrategyData,
  CampaignStrategyGroup,
  CampaignStrategyPhase,
  CampaignStrategyPhaseKey,
  CampaignStrategyPhaseStatus,
  CampaignStrategyTask,
  CampaignTaskDefinition,
  PriorityTier,
  TaskTiming,
} from './campaignStrategy.types'

// Sequences the hand-authored TASK_CATALOG into the render shape: resolves each
// task's timing to a date, expands generated-per-item tasks (community events),
// binds the deterministic pills we have (cellphone/landline counts), buckets by
// phase -> category, derives phase status, and marks the single "Do this next".
// Dynamic-task COPY is rendered as authored — LLM personalization is a later
// step (see the refactor plan in campaign-tracker-v3-context.md).

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

const TIER_RANK: Record<PriorityTier, number> = { P1: 0, P2: 1, P3: 2, P4: 3 }

// June 17 rules: Active Campaign + GOTV surface 3 tasks per week; completing
// one reveals the next (progressive reveal). GOTV tasks only appear in the
// final 30 days; before that the phase shows a blue informational banner.
const WEEKLY_LIMIT = 3
const GOTV_WINDOW_DAYS = 30

interface BuildCampaignStrategyInput {
  electionDate: Date | null
  campaignStart: Date | null
  uniqueCellphones: number | null
  uniqueLandlines: number | null
  // pill token -> ISO date for jurisdiction-dependent markers we actually have.
  jurisdictionDates?: Partial<Record<string, string>>
  today?: Date
}

const toIso = (date: Date): string => format(date, 'yyyy-MM-dd')

// Resolve a task's structured timing to an ISO date, or null when undated
// (recurring habits, per-item templates, and jurisdiction dates we lack).
const resolveDate = (
  timing: TaskTiming,
  input: BuildCampaignStrategyInput,
  start: Date,
): string | null => {
  switch (timing.kind) {
    case 'asap':
    case 'onboardingWeek':
      return toIso(start)
    case 'preLaunch':
      return toIso(addDays(start, 7))
    case 'launch':
      return toIso(addDays(start, 14))
    case 'electionRelative':
      if (!input.electionDate) return null
      return toIso(
        timing.unit === 'weeks'
          ? subWeeks(input.electionDate, timing.offset)
          : subDays(input.electionDate, timing.offset),
      )
    case 'electionDay':
      return input.electionDate ? toIso(input.electionDate) : null
    case 'afterElection':
      return input.electionDate
        ? toIso(addWeeks(input.electionDate, timing.weeks))
        : null
    case 'jurisdiction': {
      const iso = timing.pill
        ? input.jurisdictionDates?.[timing.pill]
        : undefined
      return iso ?? null
    }
    case 'recurring':
    case 'perItem':
      return null
  }
}

const paramFor = (
  def: CampaignTaskDefinition,
  input: BuildCampaignStrategyInput,
): string | null => {
  if (def.channel === 'text' && input.uniqueCellphones) {
    return `~${input.uniqueCellphones.toLocaleString('en-US')} cellphones`
  }
  if (def.channel === 'robocall' && input.uniqueLandlines) {
    return `~${input.uniqueLandlines.toLocaleString('en-US')} landlines`
  }
  return null
}

const toRenderTask = (
  def: CampaignTaskDefinition,
  input: BuildCampaignStrategyInput,
  start: Date,
): CampaignStrategyTask => ({
  id: def.id,
  title: def.title,
  description: def.description,
  channel: def.channel,
  date: resolveDate(def.timing, input, start),
  param: paramFor(def, input),
  href: null,
  hrefLabel: null,
  priorityTier: def.priorityTier,
  proRequired: def.proRequired,
  status: def.status,
  unlocksAfter: def.unlocksAfter ?? null,
  isNext: false,
  completed: false,
})

const dateValue = (task: CampaignStrategyTask): number =>
  task.date ? new Date(task.date.replace(/-/g, '/')).getTime() : Infinity

// Within a group: dated tasks first (chronological), then undated, tier breaks ties.
const compareTasks = (
  a: CampaignStrategyTask,
  b: CampaignStrategyTask,
): number =>
  dateValue(a) - dateValue(b) ||
  TIER_RANK[a.priorityTier] - TIER_RANK[b.priorityTier]

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

export const buildCampaignStrategy = (
  input: BuildCampaignStrategyInput,
): CampaignStrategyData => {
  const today = input.today ?? new Date()
  const start = input.campaignStart ?? today

  // Expand the catalog into render tasks.
  const renderTasks: {
    def: CampaignTaskDefinition
    task: CampaignStrategyTask
  }[] = []
  for (const def of CAMPAIGN_TASK_CATALOG) {
    renderTasks.push({ def, task: toRenderTask(def, input, start) })
  }

  // Bucket by phase, then group by category (catalog order preserved).
  const phaseLatestDate = new Map<CampaignStrategyPhaseKey, number | null>()
  const phases: CampaignStrategyPhase[] = PHASE_META.map((meta) => {
    const inPhase = renderTasks.filter(({ def }) => def.phase === meta.key)

    const groupOrder: string[] = []
    const byCategory = new Map<string, CampaignStrategyTask[]>()
    for (const { def, task } of inPhase) {
      if (!byCategory.has(def.category)) {
        byCategory.set(def.category, [])
        groupOrder.push(def.category)
      }
      byCategory.get(def.category)?.push(task)
    }

    const groups: CampaignStrategyGroup[] = groupOrder.map((category) => ({
      key: category,
      label: category,
      tasks: (byCategory.get(category) ?? []).sort(compareTasks),
    }))

    const dates = inPhase
      .map(({ task }) => (task.date ? dateValue(task) : null))
      .filter((v): v is number => v != null && Number.isFinite(v))
    phaseLatestDate.set(meta.key, dates.length ? Math.max(...dates) : null)

    return {
      key: meta.key,
      title: meta.title,
      summary: meta.summary,
      status: 'upcoming' as CampaignStrategyPhaseStatus,
      groups,
    }
  })

  const statuses = derivePhaseStatuses(phaseLatestDate, today)
  for (const phase of phases) {
    phase.status = statuses.get(phase.key) ?? 'upcoming'
  }

  // "Do this next": top task of the active phase by (date, tier), among
  // incomplete tasks. Prerequisites are shown as hints, not hard-locked in V0.
  const activePhase = phases.find((p) => p.status === 'active')
  if (activePhase) {
    const candidates = activePhase.groups
      .flatMap((g) => g.tasks)
      .filter((t) => !t.completed)
      .sort(compareTasks)
    if (candidates[0]) candidates[0].isNext = true
  }

  // Pre-launch + Launch show every task. Active Campaign + GOTV are capped to the
  // weekly set; GOTV is additionally time-gated (June 17 rules). Active is NOT
  // locked.
  const daysToElection = input.electionDate
    ? differenceInDays(input.electionDate, startOfDay(today))
    : null

  for (const phase of phases) {
    // GOTV is time-gated: before the final window it shows only a banner, no
    // tasks (the work isn't relevant yet).
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
            ? `Your get-out-the-vote push begins about ${GOTV_WINDOW_DAYS} days before election day — roughly ${inDays} day${inDays === 1 ? '' : 's'} from now. Your GOTV tasks will appear here then.`
            : `Your get-out-the-vote tasks appear here in the final ${GOTV_WINDOW_DAYS} days before election day.`,
      }
      phase.groups = []
      continue
    }

    // Active + GOTV surface the weekly top N (completing one reveals the next).
    if (phase.key === 'active' || phase.key === 'gotv') {
      const flat = phase.groups.flatMap((g) => g.tasks).sort(compareTasks)
      const completedCount = flat.filter((t) => t.completed).length
      phase.groups = [
        {
          key: 'thisWeek',
          label: '',
          tasks: flat.slice(0, WEEKLY_LIMIT + completedCount),
        },
      ]
    }
  }

  return { phases }
}
