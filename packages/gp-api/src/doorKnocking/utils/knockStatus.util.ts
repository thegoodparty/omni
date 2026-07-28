import {
  DoorKnockStatus,
  DoorKnockStatusSchema,
} from '@goodparty_org/contracts'
import { DoorKnockOutcome, SupportAnswer } from '../../generated/prisma'

const STATUS = DoorKnockStatusSchema.enum

type KnockAnswers = {
  outcome: DoorKnockOutcome
  supportAnswer: SupportAnswer | null
}

// Support answers outrank door outcomes; 'unsure' (and answered-with-no-
// support-answer) deliberately reads as unknown — the door is still worth
// knocking.
export const deriveKnockStatus = (
  interaction: KnockAnswers | undefined,
): DoorKnockStatus => {
  if (!interaction) return STATUS.unknown
  if (interaction.supportAnswer === SupportAnswer.supporter) {
    return STATUS.supporter
  }
  if (interaction.supportAnswer === SupportAnswer.non_supporter) {
    return STATUS.non_supporter
  }
  if (interaction.outcome === DoorKnockOutcome.refused_to_engage) {
    return STATUS.refused
  }
  if (interaction.outcome === DoorKnockOutcome.inaccessible) {
    return STATUS.inaccessible
  }
  if (interaction.outcome === DoorKnockOutcome.not_a_voter) {
    return STATUS.not_a_voter
  }
  if (interaction.outcome === DoorKnockOutcome.not_home) {
    return STATUS.not_home
  }
  return STATUS.unknown
}

// Most-actionable-first: one unknown person keeps the whole stop knockable,
// then not-homes (retry), then settled outcomes. A Record keyed by the full
// vocabulary so the compiler forces every status to be ranked — an unranked
// status would otherwise silently roll up as unknown (knockable).
const ROLLUP_RANK: Record<DoorKnockStatus, number> = {
  unknown: 0,
  not_home: 1,
  supporter: 2,
  non_supporter: 3,
  inaccessible: 4,
  refused: 5,
  not_a_voter: 6,
}

export const rollupStopStatus = (
  statuses: DoorKnockStatus[],
): DoorKnockStatus => {
  let best: DoorKnockStatus = STATUS.unknown
  let bestRank = Number.POSITIVE_INFINITY
  for (const status of statuses) {
    const rank = ROLLUP_RANK[status]
    if (rank < bestRank) {
      best = status
      bestRank = rank
    }
  }
  return best
}
