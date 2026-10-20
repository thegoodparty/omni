import { describe, expect, it } from 'vitest'
import { DEFAULT_JUDGE_CONFIG } from './config'
import type { CaseHandling, ConditionHandling, HandlingClass } from './handling'
import {
  combineVerdict,
  handlingSignal,
  signTestTail,
  withRegressionSignals,
} from './regressionSignals'
import type { AgentScore } from './score'

const handlingOf = (
  counts: Partial<Record<HandlingClass, number>>,
): ConditionHandling => ({
  cases: Object.entries(counts).flatMap(([cls, n]) =>
    Array.from(
      { length: n },
      (_, i): CaseHandling => ({
        caseId: `${cls}-${i}`,
        attempt: 1,
        base: { primary: 'yes' },
        candidate: { primary: 'no' },
        class: cls as HandlingClass,
        ordersJudged: 1,
      }),
    ),
  ),
  notGraded: 0,
})

const SCORE: AgentScore = {
  agentId: 'priority_flow',
  shape: 'chat',
  label: "CAN'T SAY",
  labelNote: 'the interval straddles zero, so the comparison did not resolve',
  overall: {
    delta: -0.06,
    interval: { lower: -0.28, upper: 0.19 },
    cases: 24,
    judgments: 80,
    wins: 20,
    losses: 24,
    ties: 28,
    cannotDetermine: 0,
    cannotDetermineJudgments: 0,
    magnitudes: { slight: 0, clear: 0, strong: 0 },
  },
  dimensions: {},
  regressions: [],
  exclusions: {
    ungradedReasons: [],
    toolErrorCauses: [],
    infraError: 0,
    identicalConfig: 0,
    unpaired: 0,
    ungraded: 0,
  },
  scoredToolErrorCauses: [],
  positionConsistency: null,
  swappedPairs: 0,
  orderUnstablePairs: [],
  panelDisagreementRate: null,
  flags: [],
  floorFailures: [],
  floorUnclear: [],
  degradedPanel: null,
  evidence: {
    costUsd: null,
    unpriceableReason: null,
    latencyMs: { base: 0, candidate: 0, delta: 0 },
    toolErrors: { base: 0, candidate: 0, delta: 0 },
    pairs: 0,
    pricingMismatch: false,
    liveWebCases: 0,
  },
  ci: null,
  controls: [],
}

describe('signTestTail', () => {
  it('is exact for 5 of 5', () => {
    expect(signTestTail(5, 5)).toBe(0.03125)
  })

  it('is exact for 6 of 8', () => {
    expect(signTestTail(6, 8)).toBeCloseTo(37 / 256, 12)
  })

  it('is 1 for zero successes and 0 past n', () => {
    expect(signTestTail(0, 4)).toBe(1)
    expect(signTestTail(0, 0)).toBe(1)
    expect(signTestTail(5, 4)).toBe(0)
  })
})

describe('handlingSignal', () => {
  it('says WORSE on the half-prompt probe: 5 regressions, 0 improvements', () => {
    const signal = handlingSignal(
      handlingOf({
        bothHandled: 18,
        sharedFailure: 13,
        regression: 5,
        unsettled: 6,
      }),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal).toEqual({
      regressions: 5,
      improvements: 0,
      pWorse: 0.03125,
      pBetter: 1,
      says: 'WORSE',
    })
  })

  it('says nothing on 3 to 0, below the minimum number of changes', () => {
    const signal = handlingSignal(
      handlingOf({ regression: 3 }),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal.pWorse).toBe(0.125)
    expect(signal.says).toBeNull()
  })

  it('says nothing on 6 to 2, which is not significant', () => {
    const signal = handlingSignal(
      handlingOf({ regression: 6, improvement: 2 }),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal.pWorse).toBeCloseTo(0.1445, 4)
    expect(signal.says).toBeNull()
  })

  it('says BETTER on the mirror image', () => {
    const signal = handlingSignal(
      handlingOf({ improvement: 5, sharedFailure: 4 }),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal.says).toBe('BETTER')
    expect(signal.pBetter).toBe(0.03125)
  })

  it('counts neither unsettled nor shared outcomes', () => {
    const signal = handlingSignal(
      handlingOf({ unsettled: 10, sharedFailure: 10, bothHandled: 10 }),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal).toMatchObject({ regressions: 0, improvements: 0 })
    expect(signal.says).toBeNull()
  })
})

describe('combineVerdict', () => {
  it('lets either the quality label or the handling signal say WORSE', () => {
    expect(combineVerdict("CAN'T SAY", 'WORSE')).toBe('WORSE')
    expect(combineVerdict('BETTER', 'WORSE')).toBe('WORSE')
    expect(combineVerdict('WORSE', 'BETTER')).toBe('WORSE')
  })

  it('says BETTER when either does and neither says WORSE', () => {
    expect(combineVerdict("CAN'T SAY", 'BETTER')).toBe('BETTER')
    expect(combineVerdict('SAME', 'BETTER')).toBe('BETTER')
    expect(combineVerdict('BETTER', null)).toBe('BETTER')
  })

  it('keeps the quality label when the handling signal does not speak', () => {
    expect(combineVerdict("CAN'T SAY", null)).toBe("CAN'T SAY")
    expect(combineVerdict('SAME', null)).toBe('SAME')
  })
})

describe('withRegressionSignals', () => {
  it("turns CAN'T SAY into WORSE below the case floor on handling alone", () => {
    const result = withRegressionSignals(
      {
        ...SCORE,
        overall: { ...SCORE.overall, cases: 3 },
        handling: handlingOf({ regression: 5 }),
      },
      DEFAULT_JUDGE_CONFIG,
    )
    expect(result.label).toBe('WORSE')
    expect(result.signals?.qualityLabel).toBe("CAN'T SAY")
    expect(result.signals?.handling?.says).toBe('WORSE')
  })

  it('leaves a no-change sweep alone', () => {
    const result = withRegressionSignals(
      {
        ...SCORE,
        label: 'SAME',
        handling: handlingOf({
          bothHandled: 20,
          regression: 1,
          improvement: 1,
        }),
      },
      DEFAULT_JUDGE_CONFIG,
    )
    expect(result.label).toBe('SAME')
    expect(result.signals?.handling?.says).toBeNull()
  })

  it('reads no handling signal when the sweep attached no handling', () => {
    const result = withRegressionSignals(SCORE, DEFAULT_JUDGE_CONFIG)
    expect(result.label).toBe("CAN'T SAY")
    expect(result.signals).toEqual({ qualityLabel: "CAN'T SAY" })
  })
})
