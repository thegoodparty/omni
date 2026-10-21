import { describe, expect, it } from 'vitest'
import { DEFAULT_JUDGE_CONFIG } from './config'
import type { CaseHandling, ConditionHandling } from './handling'
import type { HandledValue } from './judge'
import {
  combineVerdict,
  handlingSignal,
  withRegressionSignals,
} from './regressionSignals'
import type { AgentScore } from './score'

// One case's attempts, `base` and `candidate` of them handled.
const runsOf = (
  caseId: string,
  base: number,
  candidate: number,
  attempts = 3,
): CaseHandling[] =>
  Array.from({ length: attempts }, (_, i): CaseHandling => {
    const b: HandledValue = i < base ? 'yes' : 'no'
    const c: HandledValue = i < candidate ? 'yes' : 'no'
    return {
      caseId,
      attempt: i + 1,
      base: { primary: b, swapped: b },
      candidate: { primary: c, swapped: c },
      class: 'bothHandled',
      ordersJudged: 2,
    }
  })

const handlingOf = (
  counts: readonly (readonly [number, number])[],
): ConditionHandling => ({
  cases: counts.flatMap(([b, c], i) => runsOf(`case-${i}`, b, c)),
  notGraded: 0,
})

// Per-case handled runs, base and candidate, read off live sweeps.
const AUTH_PROBE = [
  [3, 3],
  [3, 3],
  [2, 0],
  [3, 0],
  [0, 0],
  [2, 2],
  [0, 0],
  [3, 1],
] as const
const HALF_PROMPT_PROBE = [
  [3, 3],
  [3, 3],
  [2, 2],
  [3, 1],
  [2, 0],
  [3, 0],
  [3, 3],
  [3, 3],
  [2, 2],
  [2, 0],
  [0, 3],
  [2, 2],
] as const
const NO_CHANGE = [
  [3, 2],
  [3, 3],
  [2, 2],
  [3, 3],
  [0, 0],
  [3, 2],
  [0, 0],
  [2, 0],
] as const

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

describe('handlingSignal', () => {
  it('says WORSE on the probe where every tool failed auth', () => {
    const signal = handlingSignal(handlingOf(AUTH_PROBE), DEFAULT_JUDGE_CONFIG)
    expect(signal).toMatchObject({
      baseHandled: 16,
      candidateHandled: 9,
      runs: 24,
      says: 'WORSE',
    })
    expect(signal.pWorse).toBeCloseTo(0.0076, 4)
  })

  it('says nothing on a no-change sweep that leaned toward the base', () => {
    const signal = handlingSignal(handlingOf(NO_CHANGE), DEFAULT_JUDGE_CONFIG)
    expect(signal.pWorse).toBeCloseTo(0.09, 2)
    expect(signal.says).toBeNull()
  })

  it('says nothing on the half-prompt probe, whose damage stayed near noise', () => {
    const signal = handlingSignal(
      handlingOf(HALF_PROMPT_PROBE),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal.pWorse).toBeCloseTo(0.082, 3)
    expect(signal.says).toBeNull()
  })

  // 3 of 3 to 0 of 3 alone is p = 1/20, exactly alpha: one case is not enough.
  it('needs more than one case flipping all of its runs', () => {
    const one = handlingSignal(handlingOf([[3, 0]]), DEFAULT_JUDGE_CONFIG)
    expect(one.pWorse).toBeCloseTo(0.05, 10)
    expect(one.says).toBeNull()
    const two = handlingSignal(
      handlingOf([
        [3, 0],
        [3, 0],
      ]),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(two.says).toBe('WORSE')
  })

  it('weighs a case that collapsed more than one that slipped', () => {
    const collapsed = handlingSignal(
      handlingOf([
        [3, 0],
        [3, 3],
      ]),
      DEFAULT_JUDGE_CONFIG,
    )
    const slipped = handlingSignal(
      handlingOf([
        [3, 2],
        [3, 3],
      ]),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(collapsed.pWorse).toBeLessThan(slipped.pWorse)
  })

  it('learns nothing from cases both arms always pass or always fail', () => {
    const signal = handlingSignal(
      handlingOf([
        [3, 3],
        [0, 0],
        [3, 3],
      ]),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal).toMatchObject({ pWorse: 1, pBetter: 1, says: null })
  })

  it('says BETTER on the mirror image', () => {
    const mirrored = AUTH_PROBE.map(([b, c]) => [c, b] as const)
    const signal = handlingSignal(handlingOf(mirrored), DEFAULT_JUDGE_CONFIG)
    expect(signal.says).toBe('BETTER')
  })

  it('counts an order that disagreed as not handled, and skips ungraded pairs', () => {
    const signal = handlingSignal(
      {
        cases: [
          {
            caseId: 'a',
            attempt: 1,
            base: { primary: 'yes', swapped: 'yes' },
            candidate: { primary: 'yes', swapped: 'partly' },
            class: 'unsettled',
            ordersJudged: 2,
          },
          {
            caseId: 'a',
            attempt: 2,
            base: {},
            candidate: { primary: 'no' },
            class: 'sharedFailure',
            ordersJudged: 1,
          },
        ],
        notGraded: 0,
      },
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal).toMatchObject({
      baseHandled: 1,
      candidateHandled: 0,
      runs: 1,
    })
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
        handling: handlingOf(AUTH_PROBE),
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
        handling: handlingOf(NO_CHANGE),
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
