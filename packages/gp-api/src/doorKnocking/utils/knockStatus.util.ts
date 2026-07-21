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
  if (interaction.outcome === DoorKnockOutcome.not_home) {
    return STATUS.not_home
  }
  return STATUS.unknown
}

// Most-actionable-first: one unknown person keeps the whole stop knockable,
// then not-homes (retry), then settled outcomes.
const ROLLUP_PRIORITY: DoorKnockStatus[] = [
  STATUS.unknown,
  STATUS.not_home,
  STATUS.supporter,
  STATUS.non_supporter,
  STATUS.refused,
]

export const rollupStopStatus = (
  statuses: DoorKnockStatus[],
): DoorKnockStatus => {
  for (const status of ROLLUP_PRIORITY) {
    if (statuses.includes(status)) return status
  }
  return STATUS.unknown
}
