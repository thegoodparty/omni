// Presentation-layer model for the Campaign Strategy section. The task catalog
// definition + its enums now live in @goodparty_org/contracts (shared with
// gp-api + the tracker experiment); this file re-exports them and keeps the
// webapp-only render shapes below.

import type {
  CampaignStrategyPhaseKey,
  PriorityTier,
  TaskChannel,
  TaskStatus,
  TrackerTaskSkipReason,
} from '@goodparty_org/contracts'

export type {
  CampaignStrategyPhaseKey,
  TaskType,
  TaskPersonalization,
  PriorityTier,
  TaskStatus,
  TaskChannel,
  DayOfWeek,
  GeneratorSource,
  TaskTiming,
  CampaignTaskDefinition,
} from '@goodparty_org/contracts'

export type CampaignStrategyPhaseStatus = 'done' | 'active' | 'upcoming'

// Render shape for one task row.
export interface CampaignStrategyTask {
  id: string
  title: string
  description: string
  channel: TaskChannel
  date: string | null
  param: string | null
  href: string | null
  hrefLabel: string | null
  priorityTier: PriorityTier
  proRequired: boolean
  status: TaskStatus
  unlocksAfter: string | null
  isNext: boolean
  completed: boolean
  // Put off ('later') or set aside ('notForMe') right now, so never the next
  // task. A snooze that has run out reads as null.
  setAside: TrackerTaskSkipReason | null
  snoozedUntil: string | null
  // Added since this browser last showed the plan; marked for one visit.
  isNew?: boolean
  // False when `date` is only a placeholder that orders the task; it is not
  // shown as a due date. Unset means the date is real.
  dateKnown?: boolean
}

export interface CampaignStrategyGroup {
  key: string
  label: string
  tasks: CampaignStrategyTask[]
}

// When set, the phase renders an informational gate instead of its tasks.
// Currently only 'window' (GOTV before the last 30 days, a blue banner). Active
// is not gated.
export interface CampaignStrategyGate {
  kind: 'window'
  message: string
}

// One Monday-Sunday week of active-phase tasks for the week navigator. `start`
// is the Monday (ISO date). The navigator shows one week at a time and lets the
// candidate move to the immediately previous / next week.
export interface CampaignStrategyWeek {
  start: string
  tasks: CampaignStrategyTask[]
  // The week that contains "today" — the navigator's default view.
  isCurrent: boolean
}

export interface CampaignStrategyPhase {
  key: CampaignStrategyPhaseKey
  title: string
  status: CampaignStrategyPhaseStatus
  summary: string
  groups: CampaignStrategyGroup[]
  gate?: CampaignStrategyGate
  // The active phase renders as a week navigator (one Mon-Sun week at a time,
  // back/forward one week) rather than a flat group list. When set, the UI uses
  // this instead of `groups`.
  weeks?: CampaignStrategyWeek[]
}

export interface CampaignStrategyData {
  phases: CampaignStrategyPhase[]
}
