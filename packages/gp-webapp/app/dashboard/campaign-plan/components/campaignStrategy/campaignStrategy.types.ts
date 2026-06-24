// Presentation-layer model for the Campaign Strategy section. The task catalog
// definition + its enums now live in @goodparty_org/contracts (shared with
// gp-api + the tracker experiment); this file re-exports them and keeps the
// webapp-only render shapes below.

import type {
  CampaignStrategyPhaseKey,
  PriorityTier,
  TaskChannel,
  TaskStatus,
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

export interface CampaignStrategyPhase {
  key: CampaignStrategyPhaseKey
  title: string
  status: CampaignStrategyPhaseStatus
  summary: string
  groups: CampaignStrategyGroup[]
  gate?: CampaignStrategyGate
  // Progressive reveal: dynamic weekly tasks beyond the shown top-N uncompleted
  // are withheld until earlier ones are completed. Count of those withheld
  // tasks, so the UI can tell the candidate more will unlock.
  hiddenCount?: number
}

export interface CampaignStrategyData {
  phases: CampaignStrategyPhase[]
}
