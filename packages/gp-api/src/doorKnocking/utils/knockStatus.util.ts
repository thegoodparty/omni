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

// A manual support-status override, translated into the map's vocabulary.
// The two vocabularies only partly overlap: the CRM's `undecided` has no
// DoorKnockStatus member and collapses to unknown, which is the same thing
// `deriveKnockStatus` does with an 'unsure' answer — the door is still worth
// knocking. Outcome-only statuses (not_home, inaccessible, not_a_voter) can
// never arrive here because they aren't part of the override vocabulary, so
// an override never claims to know something about the door itself.
// Returns null for "no override", including an unrecognized value: a rollup
// member added without a mapping here should fall through to derivation
// rather than silently read as unknown.
export const overrideToKnockStatus = (
  value: string | undefined,
): DoorKnockStatus | null => {
  switch (value) {
    case 'supporter':
      return STATUS.supporter
    case 'non_supporter':
      return STATUS.non_supporter
    case 'refused':
      return STATUS.refused
    case 'unknown':
    case 'undecided':
      return STATUS.unknown
    default:
      return null
  }
}
