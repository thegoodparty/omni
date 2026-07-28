import { describe, expect, it } from 'vitest'
import { DoorKnockOutcome, SupportAnswer } from '../../generated/prisma'
import { deriveKnockStatus, rollupStopStatus } from './knockStatus.util'

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

describe('rollupStopStatus', () => {
  it('one unknown person keeps the stop knockable', () => {
    expect(rollupStopStatus(['supporter', 'unknown', 'refused'])).toBe(
      'unknown',
    )
  })

  it('not_home outranks settled outcomes', () => {
    expect(rollupStopStatus(['refused', 'not_home', 'supporter'])).toBe(
      'not_home',
    )
  })

  it('not_a_voter is the least actionable status', () => {
    expect(rollupStopStatus(['not_a_voter', 'refused'])).toBe('refused')
    expect(rollupStopStatus(['not_a_voter', 'inaccessible'])).toBe(
      'inaccessible',
    )
  })

  it('settled stops report their best outcome', () => {
    expect(rollupStopStatus(['refused', 'supporter'])).toBe('supporter')
    expect(rollupStopStatus(['refused', 'non_supporter'])).toBe('non_supporter')
    expect(rollupStopStatus(['refused'])).toBe('refused')
  })

  it('an empty stop is unknown', () => {
    expect(rollupStopStatus([])).toBe('unknown')
  })
})
