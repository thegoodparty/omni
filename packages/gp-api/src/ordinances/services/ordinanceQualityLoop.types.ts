import {
  Ordinance,
  OrdinanceQualityIteration,
  OrdinanceQualityLoopStatus,
} from '../../generated/prisma'

export type OrdinanceQualityLoopTrigger = 'auto' | 'manual'

export type OrdinanceQualityLoopStartReason =
  | 'flag_off'
  | 'env_off'
  | 'already_running'
  | 'manual_run_active'
  | 'status_beyond_draft'
  | 'redline_draft'
  | 'already_passing'
  | 'empty_draft'
  | 'enqueue_failed'

export interface OrdinanceQualityLoopStartInput {
  ordinance: Ordinance
  userId: number
  trigger: OrdinanceQualityLoopTrigger
}

export interface OrdinanceQualityLoopStartResult {
  started: boolean
  reason?: OrdinanceQualityLoopStartReason
}

export type OrdinanceWithLatestIteration = Ordinance & {
  latestIteration?: OrdinanceQualityIteration | null
}

// Payload of the 'Ordinances - Quality Loop Completed' Segment event. A type
// alias (not an interface) so it stays assignable to the analytics service's
// Record<string, unknown> properties bag.
export type OrdinanceQualityLoopCompletedProps = {
  status: OrdinanceQualityLoopStatus
  iterations: number
  flagsBefore: number | null
  flagsAfter: number | null
  attentionBefore: number | null
  attentionAfter: number | null
  flagToAttentionCount: number | null
  restoredIteration: number | null
  totalTokens: number
}
