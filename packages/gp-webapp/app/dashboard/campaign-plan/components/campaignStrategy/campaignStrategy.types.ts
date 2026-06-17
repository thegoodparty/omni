// Presentation-layer model for the Campaign Strategy section. The catalog
// (taskCatalog.ts) is the hand-authored source of truth, transcribed from
// campaign-tasks-master.xlsx. buildCampaignStrategy sequences the catalog into
// the render shapes below. Dynamic-task copy is rendered as authored for now;
// LLM personalization is a later step (see the refactor plan in
// campaign-tracker-v3-context.md).

export type CampaignStrategyPhaseKey =
  | 'preLaunch'
  | 'launch'
  | 'active'
  | 'gotv'

export type CampaignStrategyPhaseStatus = 'done' | 'active' | 'upcoming'

export type TaskType = 'static' | 'dynamic'

export type TaskPersonalization =
  | 'content-pill'
  | 'generated-per-item'
  | 'static'

export type PriorityTier = 'P1' | 'P2' | 'P3' | 'P4'

export type TaskStatus = 'live' | 'proposed'

export type TaskChannel =
  | 'text'
  | 'robocall'
  | 'doorKnocking'
  | 'phoneBanking'
  | 'directMail'
  | 'event'
  | 'awareness'
  | 'general'

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

// Token this task can bind once we wire pills. Kept loose for now.
export type GeneratorSource =
  | 'communityEvents'
  | 'pressOutlets'
  | 'officeMeetings'

// Structured timing the sequencer resolves to a date (or undated). Replaces a
// single weeksBeforeElection number. ED-N is encoded as electionRelative with
// an explicit unit because the sheet uses weeks for the send schedule and days
// for the final GOTV ops (an open product question, noted in the plan).
export type TaskTiming =
  | { kind: 'asap' }
  | { kind: 'onboardingWeek' }
  | { kind: 'preLaunch' }
  | { kind: 'launch' }
  | { kind: 'electionRelative'; offset: number; unit: 'weeks' | 'days' }
  | { kind: 'electionDay' }
  | { kind: 'afterElection'; weeks: number }
  // Date comes from a plan/BallotReady timeline value; undated if unavailable.
  | { kind: 'jurisdiction'; pill?: string }
  | {
      kind: 'recurring'
      interval: 'weekly' | 'monthly' | 'evenWeeks' | 'oddWeeks' | 'waves'
    }
  // Generated per item (event/outlet/meeting); date comes from the item.
  | { kind: 'perItem' }

// One hand-authored task in the catalog (mirrors the xlsx Tasks sheet).
export interface CampaignTaskDefinition {
  id: string
  phase: CampaignStrategyPhaseKey
  type: TaskType
  category: string
  title: string
  description: string
  channel: TaskChannel
  timing: TaskTiming
  dayOfWeek?: DayOfWeek
  // 'adapts' = copy/sends adapt to primary vs general (rendered the same here).
  electionType: 'both' | 'adapts'
  proRequired: boolean
  status: TaskStatus
  personalization: TaskPersonalization
  pills: string[]
  priorityTier: PriorityTier
  // Raw prerequisite label from the sheet (task title or a gate like
  // "10DLC registration"). Shown as a hint; not hard-locked in V0.
  unlocksAfter?: string
  generatorSource?: GeneratorSource
}

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

export interface CampaignStrategyPhase {
  key: CampaignStrategyPhaseKey
  title: string
  status: CampaignStrategyPhaseStatus
  summary: string
  groups: CampaignStrategyGroup[]
}

export interface CampaignStrategyData {
  phases: CampaignStrategyPhase[]
}
