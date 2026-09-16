import {
  DoorKnockStatus,
  DoorKnockStatusSchema,
} from '@goodparty_org/contracts'
import {
  DoorKnockOutcome,
  FollowUpAnswer,
  SupportAnswer,
} from '../../generated/prisma'
import {
  ANSWER_FIRMNESS,
  SUPPORT_ANSWER_FIRMNESS,
} from '@/contactInteraction/contactInteraction.types'

const STATUS = DoorKnockStatusSchema.enum

type KnockAnswers = {
  outcome: DoorKnockOutcome
  supportAnswer: SupportAnswer | null
  followUp: FollowUpAnswer | null
}

// How much authority one knock has over the knocks before it. Used to pick
// WHICH row a person's status derives from; `deriveKnockStatus` below is
// unchanged and still answers only for the row it is handed.
//
// Support answers rank on SUPPORT_ANSWER_FIRMNESS, the same constant
// SupportStatusService.derivedStatusSql orders by, because that axis is what
// both surfaces project and they must pick the same row for it.
//
// A Serve follow-up answer counts as firm here and nowhere in that SQL, which
// is the one deliberate difference. Both of its values are definite — `yes` is
// needs-follow-up, `no` is engaged — and neither is the Serve equivalent of a
// shrug, so at the door neither should be displaceable by a later not-home.
// The CRM projects only the support axis, where a follow-up answer says
// nothing at all; ranking it firm there would let a row carrying no support
// answer outrank and hide a real one, which is the bug this whole change
// exists to fix, pointed the other way.
//
// The two axes rarely meet: the contract refuses a follow-up beside a support
// answer, so only an org mid-transition between Win and Serve holds both, on
// separate rows. When that happens the two surfaces can name a person
// differently — `needs_follow_up` at the door, `undecided` in Contacts — but
// they are answering different questions in vocabularies that don't share
// those words, not contradicting each other about support.
const answerFirmness = (interaction: KnockAnswers): number => {
  if (interaction.followUp !== null) return ANSWER_FIRMNESS.firm
  if (interaction.supportAnswer === null) return ANSWER_FIRMNESS.none
  return SUPPORT_ANSWER_FIRMNESS[interaction.supportAnswer]
}

// The row a person's status derives from: the firmest answer they ever gave.
// Ties need no comparison because the caller hands rows over newest-first, so
// the first row at a given firmness is already the most recent one.
//
// One function because there are two callers and they colour the same door:
// `DoorKnockingStatusService.latestKnockStatuses` colours the row a canvasser
// taps, `DoorKnockingPackService` colours the pin they tapped it from. They
// held separate copies of the same loop, which is one divergence away from
// showing a person one status on the map and another in the walk.
// `SupportStatusService.derivedStatusSql` is the third, in SQL, ordering by
// SUPPORT_ANSWER_FIRMNESS — see `answerFirmness` for the follow-up axis it
// does not share, and why.
//
// `DoorKnockingInteractionService.record` is a fourth reader by way of
// `latestKnockStatuses`: what it returns recolors the dot on the phone, so it
// has to answer for the person rather than for the row it just wrote.
export const firmestAnswerPerPerson = <
  Row extends KnockAnswers & { personId: string },
>(
  newestFirst: readonly Row[],
): Map<string, Row> => {
  const firmest = new Map<string, Row>()
  for (const row of newestFirst) {
    const held = firmest.get(row.personId)
    if (!held || answerFirmness(row) > answerFirmness(held)) {
      firmest.set(row.personId, row)
    }
  }
  return firmest
}

// Support answers outrank door outcomes; 'unsure' (and answered-with-no-
// support-answer) deliberately reads as unknown — the door is still worth
// knocking.
//
// **This stays a pure function of the row, with no org flag threaded into it.**
// A non-null `followUp` can only have come from a Serve form — the contract
// refuses it beside a support answer, and no Win surface offers the question —
// so the surface is already recorded in the answers themselves. Passing the
// org in would mean the pack service, the status service and every caller
// between them learning about Win and Serve to re-derive something the row
// already says, and a Serve row read with a Win flag would then derive
// differently depending on who asked.
//
// Existing `eo-` pilot rows carry support answers and no follow-up, so they
// keep deriving supporter/non_supporter. Not backfilled: at internal-beta
// volume the rows are countable, and rewriting logged answers into a
// vocabulary their canvasser was never offered would be inventing data.
export const deriveKnockStatus = (
  interaction: KnockAnswers | undefined,
): DoorKnockStatus => {
  if (!interaction) return STATUS.unknown
  if (interaction.followUp === FollowUpAnswer.yes) {
    return STATUS.needs_follow_up
  }
  if (interaction.followUp === FollowUpAnswer.no) return STATUS.engaged
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
