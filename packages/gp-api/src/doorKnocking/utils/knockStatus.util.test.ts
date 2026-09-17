import { describe, expect, it } from 'vitest'
import {
  DoorKnockOutcome,
  FollowUpAnswer,
  SupportAnswer,
} from '../../generated/prisma'
import { deriveKnockStatus } from './knockStatus.util'

// Both answer columns are required on the input, so every case has to state
// which surface's row it is. Named defaults rather than an optional field on
// `KnockAnswers`: a caller that forgot to select `follow_up` would otherwise
// derive Win statuses for Serve rows and typecheck clean.
const knock = (row: {
  outcome: DoorKnockOutcome
  supportAnswer?: SupportAnswer | null
  followUp?: FollowUpAnswer | null
}) =>
  deriveKnockStatus({
    supportAnswer: null,
    followUp: null,
    ...row,
  })

describe('deriveKnockStatus', () => {
  it('returns unknown for a person never knocked', () => {
    expect(deriveKnockStatus(undefined)).toBe('unknown')
  })

  it('support answers outrank door outcomes', () => {
    expect(
      knock({
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.supporter,
      }),
    ).toBe('supporter')
    expect(
      knock({
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.non_supporter,
      }),
    ).toBe('non_supporter')
  })

  it('unsure reads as unknown — the door is still worth knocking', () => {
    expect(
      knock({
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.unsure,
      }),
    ).toBe('unknown')
  })

  // The Serve surface's two endings, and the reason they exist: without them a
  // conversation an elected official's canvasser actually had derives to
  // `unknown`, which every "logged" predicate in the feature reads as a door
  // nobody has been to.
  it('derives the Serve statuses from the follow-up answer', () => {
    expect(
      knock({
        outcome: DoorKnockOutcome.answered,
        followUp: FollowUpAnswer.yes,
      }),
    ).toBe('needs_follow_up')
    expect(
      knock({
        outcome: DoorKnockOutcome.answered,
        followUp: FollowUpAnswer.no,
      }),
    ).toBe('engaged')
  })

  // The contract refuses both answers on one payload, so this only arises for a
  // row written before that refinement existed. Follow-up winning is what keeps
  // the Win ladder underneath it byte-identical.
  it('prefers follow-up over a support answer on the same row', () => {
    expect(
      knock({
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.supporter,
        followUp: FollowUpAnswer.yes,
      }),
    ).toBe('needs_follow_up')
  })

  it('maps the door-knocking-tool outcomes', () => {
    expect(knock({ outcome: DoorKnockOutcome.inaccessible })).toBe(
      'inaccessible',
    )
    expect(knock({ outcome: DoorKnockOutcome.not_a_voter })).toBe('not_a_voter')
  })

  it('maps door outcomes when no support answer exists', () => {
    expect(knock({ outcome: DoorKnockOutcome.refused_to_engage })).toBe(
      'refused',
    )
    expect(knock({ outcome: DoorKnockOutcome.not_home })).toBe('not_home')
    expect(knock({ outcome: DoorKnockOutcome.answered })).toBe('unknown')
  })
})
