import { describe, expect, it } from 'vitest'
import {
  conditionHandling,
  handlingPairKey,
  oneOrderOnly,
  ordersDisagree,
} from './handling'
import type { GradedJudgment, HandledValue, JudgmentOrder } from './judge'
import type { SlotMap } from './normalize'

const ASKED = new Set([handlingPairKey('t2-conflict', 1)])

const X_IS_BASE: SlotMap = { X: 'base', Y: 'candidate' }
const X_IS_CANDIDATE: SlotMap = { X: 'candidate', Y: 'base' }

const judged = (
  order: JudgmentOrder,
  slotMap: SlotMap,
  x: HandledValue,
  y: HandledValue,
  caseId = 't2-conflict',
): GradedJudgment => ({
  kind: 'graded',
  key: { caseId, attempt: 1, order },
  slotMap,
  dimensions: {},
  seats: [],
  seatFailures: [],
  flags: [],
  absoluteFloor: null,
  handled: { X: x, Y: y },
})

describe('condition handling per case', () => {
  // A swapped judgment puts the other arm in X, so reading X as the base
  // there would swap the two arms' answers.
  it('orients each order through its own slot map', () => {
    const {
      cases: [only],
    } = conditionHandling(
      [
        judged('primary', X_IS_BASE, 'yes', 'no'),
        judged('swapped', X_IS_CANDIDATE, 'no', 'yes'),
      ],
      ASKED,
    )
    expect(only?.base).toEqual({ primary: 'yes', swapped: 'yes' })
    expect(only?.candidate).toEqual({ primary: 'no', swapped: 'no' })
    expect(only?.class).toBe('regression')
  })

  it('names an improvement the other way round', () => {
    const {
      cases: [only],
    } = conditionHandling([judged('primary', X_IS_BASE, 'no', 'yes')], ASKED)
    expect(only?.class).toBe('improvement')
  })

  // Partly is shown as itself, and is not handled.
  it.each([
    ['yes', 'partly', 'regression'],
    ['partly', 'partly', 'sharedFailure'],
    ['no', 'no', 'sharedFailure'],
    ['yes', 'yes', 'bothHandled'],
  ] as const)('base %s, candidate %s is %s', (base, candidate, expected) => {
    const {
      cases: [only],
    } = conditionHandling(
      [judged('primary', X_IS_BASE, base, candidate)],
      ASKED,
    )
    expect(only?.class).toBe(expected)
  })

  // A value that moves with the slot is not a reading of the run.
  it('counts an arm whose orders disagree as not handled', () => {
    const {
      cases: [only],
    } = conditionHandling(
      [
        judged('primary', X_IS_BASE, 'yes', 'yes'),
        judged('swapped', X_IS_CANDIDATE, 'yes', 'no'),
      ],
      ASKED,
    )
    expect(only?.base).toEqual({ primary: 'yes', swapped: 'no' })
    expect(only && ordersDisagree(only.base)).toBe(true)
    expect(only?.class).toBe('improvement')
  })

  // Asked, but the judge never answered: counted, not silently dropped.
  it('counts a pair asked but never graded', () => {
    const ungraded = {
      kind: 'ungraded' as const,
      key: { caseId: 't2-conflict', attempt: 1, order: 'primary' as const },
      reason: 'seat failed',
    }
    expect(conditionHandling([ungraded], ASKED)).toEqual({
      cases: [],
      notGraded: 1,
    })
  })

  it('marks a value read in one order of two', () => {
    const {
      cases: [only],
    } = conditionHandling(
      [
        judged('primary', X_IS_BASE, 'yes', 'no'),
        {
          kind: 'ungraded',
          key: { caseId: 't2-conflict', attempt: 1, order: 'swapped' },
          reason: 'seat failed',
        },
      ],
      ASKED,
    )
    expect(only && oneOrderOnly(only, only.base)).toBe(true)
  })

  it('reads nothing from a case that asked nothing', () => {
    const unasked: GradedJudgment = {
      ...judged('primary', X_IS_BASE, 'yes', 'no'),
      handled: undefined,
    }
    expect(conditionHandling([unasked], new Set()).cases).toEqual([])
  })
})
