import { describe, expect, it } from 'vitest'
import { DoorKnockOutcome, SupportAnswer } from '../../generated/prisma'
import { deriveKnockStatus } from './knockStatus.util'

describe('deriveKnockStatus', () => {
  it('returns unknown for a person never knocked', () => {
    expect(deriveKnockStatus(undefined)).toBe('unknown')
  })

  it('support answers outrank door outcomes', () => {
    expect(
      deriveKnockStatus({
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.supporter,
      }),
    ).toBe('supporter')
    expect(
      deriveKnockStatus({
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.non_supporter,
      }),
    ).toBe('non_supporter')
  })

  it('unsure reads as unknown — the door is still worth knocking', () => {
    expect(
      deriveKnockStatus({
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.unsure,
      }),
    ).toBe('unknown')
  })

  it('maps the door-knocking-tool outcomes', () => {
    expect(
      deriveKnockStatus({
        outcome: DoorKnockOutcome.inaccessible,
        supportAnswer: null,
      }),
    ).toBe('inaccessible')
    expect(
      deriveKnockStatus({
        outcome: DoorKnockOutcome.not_a_voter,
        supportAnswer: null,
      }),
    ).toBe('not_a_voter')
  })

  it('maps door outcomes when no support answer exists', () => {
    expect(
      deriveKnockStatus({
        outcome: DoorKnockOutcome.refused_to_engage,
        supportAnswer: null,
      }),
    ).toBe('refused')
    expect(
      deriveKnockStatus({
        outcome: DoorKnockOutcome.not_home,
        supportAnswer: null,
      }),
    ).toBe('not_home')
    expect(
      deriveKnockStatus({
        outcome: DoorKnockOutcome.answered,
        supportAnswer: null,
      }),
    ).toBe('unknown')
  })
})
