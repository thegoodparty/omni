import { describe, expect, it } from 'vitest'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import {
  BACKGROUND_TOOL_ERROR_PAIR,
  BLOCKED_PAIR,
  CHAT_PAIR,
  INFRA_ERROR_PAIR,
  TOOL_ERROR_PAIR,
} from './fixtures/records'
import {
  OVERALL,
  type GradedJudgment,
  type Judgment,
  type JudgmentOrder,
  type Magnitude,
  type SlotVerdict,
} from './judge'
import {
  normalizeAgent,
  SLOTS,
  type NormalizedAgent,
  type SlotMap,
} from './normalize'
import { orient, scoreAgent, type AgentScore } from './score'
import type { Cost, RunRecord } from './record'

// `cost` is optional on a record, for the run nobody could price. These
// helpers adjust a fixture's EXISTING cost rather than testing the absent
// case, so an absent one is a broken fixture and says so rather than
// quietly producing a record with no price.
const costOf = (record: RunRecord): Cost => {
  const cost = record.telemetry.cost
  if (cost === undefined) {
    throw new Error(`${record.runId} has no cost to adjust`)
  }
  return cost
}

const [BASE, CANDIDATE] = CHAT_PAIR

const X_IS_BASE: SlotMap = { X: 'base', Y: 'candidate' }
const X_IS_CANDIDATE: SlotMap = { X: 'candidate', Y: 'base' }

const dims = (verdict: SlotVerdict, magnitude: Magnitude | null = 'clear') =>
  Object.fromEntries(
    [...DEFAULT_JUDGE_CONFIG.dimensions, OVERALL].map((name) => [
      name,
      {
        verdict,
        magnitude:
          verdict === 'tie' || verdict === 'cannot_determine'
            ? null
            : magnitude,
        seatsAgreed: true,
        directionConflict: false,
      },
    ]),
  )

interface JudgmentSpec {
  caseId: string
  attempt?: number
  order?: JudgmentOrder
  slotMap: SlotMap
  verdict: SlotVerdict
  magnitude?: Magnitude | null
  flags?: GradedJudgment['flags']
  floor?: GradedJudgment['absoluteFloor']
  seatFailures?: GradedJudgment['seatFailures']
}

const judgment = (spec: JudgmentSpec): GradedJudgment => ({
  kind: 'graded',
  key: {
    caseId: spec.caseId,
    attempt: spec.attempt ?? 1,
    order: spec.order ?? 'primary',
  },
  slotMap: spec.slotMap,
  dimensions: dims(spec.verdict, spec.magnitude ?? 'clear'),
  seats: [],
  seatFailures: spec.seatFailures ?? [],
  flags: spec.flags ?? [],
  absoluteFloor: spec.floor ?? null,
})

// An agent with no records: scoring reads records only for the measured
// layer, so most tests care about the judgments alone.
const emptyAgent = (): NormalizedAgent => ({
  agentId: 'chief_of_staff',
  shape: 'chat',
  judgeable: [],
  excluded: [],
  unpaired: [],
  identicalConfig: null,
})

const score = (
  judgments: readonly Judgment[],
  config: Partial<JudgeConfig> = {},
  normalized: NormalizedAgent = emptyAgent(),
): AgentScore =>
  scoreAgent({ normalized, judgments }, { ...DEFAULT_JUDGE_CONFIG, ...config })

// Only the case count gate gets in the way of most of these tests, so
// lower it rather than inventing twenty cases each time.
const noFloor = (extra: Partial<JudgeConfig> = {}): Partial<JudgeConfig> => ({
  gates: { ...DEFAULT_JUDGE_CONFIG.gates, minCases: 1 },
  orderSwap: { enabled: false, fraction: 0 },
  ...extra,
})

describe('orient', () => {
  it.each([
    ['X' as const, X_IS_CANDIDATE, 1],
    ['X' as const, X_IS_BASE, -1],
    ['Y' as const, X_IS_CANDIDATE, -1],
    ['Y' as const, X_IS_BASE, 1],
    ['tie' as const, X_IS_BASE, 0],
  ])('turns %s into %i with the right map', (verdict, map, expected) => {
    expect(orient(verdict, map)).toBe(expected)
  })

  // A zero is the judge saying the runs are equally good. This is the judge
  // saying it could not tell, which is a different fact and must not be
  // averaged in as agreement.
  it('excludes cannot_determine rather than scoring it zero', () => {
    expect(orient('cannot_determine', X_IS_BASE)).toBeNull()
  })
})

describe('un-blinding', () => {
  // The test that catches an inverted orientation. The slot the judge
  // picked ALTERNATES between cases, so an implementation that assumed X is
  // always the candidate would land near zero instead of at +1.
  it('scores +1 when the candidate always wins, from either slot', () => {
    const judgments = Array.from({ length: 20 }, (_, i) => {
      const xIsCandidate = i % 2 === 0
      return judgment({
        caseId: `case-${i}`,
        slotMap: xIsCandidate ? X_IS_CANDIDATE : X_IS_BASE,
        verdict: xIsCandidate ? 'X' : 'Y',
      })
    })
    const result = score(judgments, noFloor())
    expect(result.overall.delta).toBe(1)
    expect(result.overall.wins).toBe(20)
    expect(result.overall.losses).toBe(0)
    expect(result.label).toBe('BETTER')
  })

  it('scores -1 when the base always wins, from either slot', () => {
    const judgments = Array.from({ length: 20 }, (_, i) => {
      const xIsCandidate = i % 2 === 0
      return judgment({
        caseId: `case-${i}`,
        slotMap: xIsCandidate ? X_IS_CANDIDATE : X_IS_BASE,
        verdict: xIsCandidate ? 'Y' : 'X',
      })
    })
    const result = score(judgments, noFloor())
    expect(result.overall.delta).toBe(-1)
    expect(result.label).toBe('WORSE')
  })

  // A judge with a fixed slot preference produces no signal once the slots
  // were assigned at random, which is the entire reason for blinding. Note
  // the label: a delta of zero with a wide interval is NOT equivalence, it
  // is a comparison that did not resolve.
  it('scores zero when the judge just always picks slot X', () => {
    const judgments = Array.from({ length: 20 }, (_, i) =>
      judgment({
        caseId: `case-${i}`,
        slotMap: i % 2 === 0 ? X_IS_CANDIDATE : X_IS_BASE,
        verdict: 'X',
      }),
    )
    const result = score(judgments, noFloor())
    expect(result.overall.delta).toBe(0)
    expect(result.label).toBe("CAN'T SAY")
    expect(result.labelNote).toMatch(/straddles zero/)
  })
})

describe('case weighting', () => {
  // Each case carries equal weight regardless of how many attempts produced
  // a verdict. A judgment-level mean would report +0.8 here.
  it('averages within a case before averaging across cases', () => {
    const judgments = [
      ...Array.from({ length: 9 }, (_, i) =>
        judgment({
          caseId: 'busy',
          attempt: i + 1,
          slotMap: X_IS_CANDIDATE,
          verdict: 'X',
        }),
      ),
      judgment({ caseId: 'quiet', slotMap: X_IS_CANDIDATE, verdict: 'Y' }),
    ]
    const result = score(judgments, noFloor())
    expect(result.overall.delta).toBe(0)
    expect(result.overall.cases).toBe(2)
    expect(result.overall.judgments).toBe(10)
  })

  // The bootstrap resamples cases, not judgments. Same twenty judgments,
  // clustered into two cases instead of twenty: the interval must widen,
  // because attempts of one case are correlated and pretending otherwise is
  // how a noisy comparison comes out looking decisive.
  it('widens the interval when the same judgments cluster tighter', () => {
    const verdicts: SlotVerdict[] = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? 'X' : 'Y',
    )
    const spread = verdicts.map((verdict, i) =>
      judgment({ caseId: `case-${i}`, slotMap: X_IS_CANDIDATE, verdict }),
    )
    const clustered = verdicts.map((verdict, i) =>
      judgment({
        caseId: i % 2 === 0 ? 'all-wins' : 'all-losses',
        attempt: Math.floor(i / 2) + 1,
        slotMap: X_IS_CANDIDATE,
        verdict,
      }),
    )
    const wide = score(clustered, noFloor()).overall.interval
    const narrow = score(spread, noFloor()).overall.interval
    expect(wide).not.toBeNull()
    expect(narrow).not.toBeNull()
    const widthOf = (i: { lower: number; upper: number } | null): number =>
      i === null ? 0 : i.upper - i.lower
    expect(widthOf(wide)).toBeGreaterThan(widthOf(narrow))
  })
})

describe('the order-swap subsample', () => {
  const swapPair = (
    caseId: string,
    primary: SlotVerdict,
    swapped: SlotVerdict,
  ): GradedJudgment[] => [
    judgment({ caseId, slotMap: X_IS_CANDIDATE, verdict: primary }),
    judgment({
      caseId,
      order: 'swapped',
      slotMap: X_IS_BASE,
      verdict: swapped,
    }),
  ]

  // Both orders said the candidate, even though the candidate moved slots
  // between them. That is agreement, and the pair keeps its full weight.
  it('keeps the verdict when both orders agree', () => {
    const result = score(swapPair('c', 'X', 'Y'), noFloor())
    expect(result.overall.delta).toBe(1)
    expect(result.positionConsistency).toBe(1)
    expect(result.orderUnstablePairs).toEqual([])
  })

  it('halves a win that the other order called a tie', () => {
    const result = score(swapPair('c', 'X', 'tie'), noFloor())
    expect(result.overall.delta).toBe(0.5)
    expect(result.positionConsistency).toBe(0)
  })

  // The judge read position rather than quality, so the pair contributes
  // nothing and is named.
  it('zeroes an outright conflict and names the pair', () => {
    const result = score(swapPair('c', 'X', 'X'), noFloor())
    expect(result.overall.delta).toBe(0)
    expect(result.orderUnstablePairs).toEqual(['c#1'])
  })

  it('reports the consistency rate over the swapped pairs only', () => {
    const result = score(
      [
        ...swapPair('a', 'X', 'Y'),
        ...swapPair('b', 'X', 'Y'),
        ...swapPair('c', 'X', 'X'),
        judgment({ caseId: 'd', slotMap: X_IS_CANDIDATE, verdict: 'X' }),
      ],
      noFloor(),
    )
    expect(result.positionConsistency).toBeCloseTo(2 / 3, 10)
  })

  // TEN SWAPPED PAIRS, because the gate now needs a denominator before it can
  // fail anything. Six of ten agree, under the 0.7 floor.
  it("gates to CAN'T SAY when the orders disagree too often", () => {
    // ('X', 'Y') is the CONSISTENT pair: the slots flip between orders, so
    // naming the same letter twice names opposite arms.
    const agreeing = [1, 2, 3, 4, 5, 6].flatMap((n) =>
      swapPair(`ok${n}`, 'X', 'Y'),
    )
    const conflicting = [1, 2, 3, 4].flatMap((n) =>
      swapPair(`bad${n}`, 'X', 'X'),
    )
    const result = score([...agreeing, ...conflicting], noFloor())
    expect(result.swappedPairs).toBe(10)
    expect(result.positionConsistency).toBeCloseTo(0.6, 10)
    expect(result.label).toBe("CAN'T SAY")
    expect(result.labelNote).toMatch(/reading position/)
  })

  // WHAT THE FIRST LIVE SWEEP ACTUALLY PRODUCED: 24 pairs, orderSwap.fraction
  // 0.2, so a stride of 5 and five swapped pairs. Three of five agreed, and
  // the 0.7 floor would have failed a whole sweep on a sample that cannot
  // distinguish a biased judge from a coin. The rate is still reported — it
  // just does not decide anything.
  it('does not gate on a sample too small to mean anything', () => {
    const agreeing = [1, 2, 3].flatMap((n) => swapPair(`ok${n}`, 'X', 'Y'))
    const conflicting = [1, 2].flatMap((n) => swapPair(`bad${n}`, 'X', 'X'))
    const result = score([...agreeing, ...conflicting], noFloor())
    expect(result.swappedPairs).toBe(5)
    expect(result.positionConsistency).toBeCloseTo(0.6, 10)
    expect(result.labelNote ?? '').not.toMatch(/reading position/)
  })

  it('carries the denominator so a rate can be read', () => {
    const result = score(
      [...swapPair('a', 'X', 'Y'), ...swapPair('b', 'X', 'X')],
      noFloor(),
    )
    expect(result.swappedPairs).toBe(2)
  })
})

describe('the magnitude distribution', () => {
  // The order-swap subsample judges the same pair twice, so a magnitude
  // counted per judgment reports one pair's strength as two — printed two
  // lines below a case count that says one.
  it('counts a magnitude once per pair, not once per order', () => {
    const result = score(
      [
        judgment({
          caseId: 'a',
          slotMap: X_IS_CANDIDATE,
          verdict: 'X',
          magnitude: 'clear',
        }),
        judgment({
          caseId: 'a',
          order: 'swapped',
          slotMap: X_IS_BASE,
          verdict: 'Y',
          magnitude: 'clear',
        }),
      ],
      noFloor(),
    )
    expect(result.overall.cases).toBe(1)
    expect(result.overall.magnitudes).toEqual({
      slight: 0,
      clear: 1,
      strong: 0,
    })
  })
})

describe('the win/tie/loss counts', () => {
  const bothOrders = (
    caseId: string,
    primary: SlotVerdict,
    swapped: SlotVerdict,
  ): GradedJudgment[] => [
    judgment({ caseId, slotMap: X_IS_CANDIDATE, verdict: primary }),
    judgment({
      caseId,
      order: 'swapped',
      slotMap: X_IS_BASE,
      verdict: swapped,
    }),
  ]

  // Same failure the magnitude distribution had: the order-swap subsample
  // judges one pair twice, so a per-judgment tally reads high against the
  // case count the report prints in the very same table row.
  it('counts one win per pair, not once per order', () => {
    const result = score(bothOrders('a', 'X', 'Y'), noFloor())
    expect(result.overall.cases).toBe(1)
    expect(result.overall.wins).toBe(1)
    expect(result.overall.ties).toBe(0)
    expect(result.overall.losses).toBe(0)
    expect(result.overall.judgments).toBe(2)
  })

  it('counts one loss per pair, not once per order', () => {
    const result = score(bothOrders('a', 'Y', 'X'), noFloor())
    expect(result.overall.losses).toBe(1)
    expect(result.overall.wins).toBe(0)
  })

  // The delta scored this pair as a single half-win. Tallying the raw
  // judgments would print it as a win AND a tie, so the row would claim
  // two outcomes for one comparison.
  it('reports a reconciled half-win as one win, not a win and a tie', () => {
    const result = score(bothOrders('a', 'X', 'tie'), noFloor())
    expect(result.overall.delta).toBe(0.5)
    expect(result.overall.wins).toBe(1)
    expect(result.overall.ties).toBe(0)
  })

  // An order-unstable pair contributes a zero to the delta, so the row has
  // to show it as a tie rather than as one win and one loss.
  it('reports an order-unstable pair as one tie', () => {
    const result = score(bothOrders('a', 'X', 'X'), noFloor())
    expect(result.orderUnstablePairs).toEqual(['a#1'])
    expect(result.overall.ties).toBe(1)
    expect(result.overall.wins).toBe(0)
    expect(result.overall.losses).toBe(0)
  })

  // Every pair lands in exactly one bucket, so the four columns sum to the
  // pair count and a reader can recover the denominator from the row.
  it('puts every pair in exactly one bucket', () => {
    const result = score(
      [
        ...bothOrders('a', 'X', 'Y'),
        ...bothOrders('b', 'X', 'tie'),
        ...bothOrders('c', 'X', 'X'),
        judgment({ caseId: 'd', slotMap: X_IS_CANDIDATE, verdict: 'Y' }),
        judgment({
          caseId: 'e',
          slotMap: X_IS_CANDIDATE,
          verdict: 'cannot_determine',
        }),
      ],
      noFloor(),
    )
    const { wins, ties, losses, cannotDetermine, judgments } = result.overall
    expect(wins + ties + losses + cannotDetermine).toBe(5)
    expect(judgments).toBe(8)
  })
})

describe("cannot_determine and CAN'T SAY", () => {
  it('leaves cannot_determine out of the delta but counts it', () => {
    const result = score(
      [
        judgment({ caseId: 'a', slotMap: X_IS_CANDIDATE, verdict: 'X' }),
        judgment({
          caseId: 'b',
          slotMap: X_IS_CANDIDATE,
          verdict: 'cannot_determine',
        }),
      ],
      noFloor(),
    )
    expect(result.overall.delta).toBe(1)
    expect(result.overall.cases).toBe(1)
    expect(result.overall.cannotDetermine).toBe(1)
  })

  // The column beside the case count is per pair. The rate the ceiling
  // gate reads is per judgment, because "how often does the judge decline"
  // is a fact about judge calls.
  it('counts one refusal per pair and keeps a per-judgment rate', () => {
    const result = score(
      [
        judgment({
          caseId: 'a',
          slotMap: X_IS_CANDIDATE,
          verdict: 'cannot_determine',
        }),
        judgment({
          caseId: 'a',
          order: 'swapped',
          slotMap: X_IS_BASE,
          verdict: 'cannot_determine',
        }),
      ],
      noFloor(),
    )
    expect(result.overall.cannotDetermine).toBe(1)
    expect(result.overall.cannotDetermineJudgments).toBe(2)
    expect(result.overall.judgments).toBe(2)
  })

  // Guards the unit of the gate's ratio, not just its numerator. Four of
  // twenty pairs were declined in both orders: 8 of 24 judgments is over
  // the 25% ceiling, while 4 pairs against 24 judgments is not.
  it('reads the ceiling in judgments, not pairs over judgments', () => {
    const declined = Array.from({ length: 4 }, (_, i) => [
      judgment({
        caseId: `no-${i}`,
        slotMap: X_IS_CANDIDATE,
        verdict: 'cannot_determine',
      }),
      judgment({
        caseId: `no-${i}`,
        order: 'swapped',
        slotMap: X_IS_BASE,
        verdict: 'cannot_determine',
      }),
    ]).flat()
    const decided = Array.from({ length: 16 }, (_, i) =>
      judgment({ caseId: `yes-${i}`, slotMap: X_IS_CANDIDATE, verdict: 'X' }),
    )
    const result = score([...declined, ...decided], noFloor())
    expect(result.overall.cannotDetermine).toBe(4)
    expect(result.overall.cannotDetermineJudgments).toBe(8)
    expect(result.overall.judgments).toBe(24)
    expect(result.label).toBe("CAN'T SAY")
    expect(result.labelNote).toMatch(/could not tell on 33%/)
  })

  it('gates when the judge could not tell too often', () => {
    const judgments = Array.from({ length: 20 }, (_, i) =>
      judgment({
        caseId: `case-${i}`,
        slotMap: X_IS_CANDIDATE,
        verdict: i < 10 ? 'cannot_determine' : 'X',
      }),
    )
    const result = score(judgments, noFloor())
    expect(result.label).toBe("CAN'T SAY")
    expect(result.labelNote).toMatch(/could not tell on 50%/)
  })

  // THE BACKGROUND BUDGET LANDS UNDER THE FLOOR — checked against the gate
  // itself rather than restated as `3 < 20`. The number of judgments is
  // DERIVED from the budget, and every one of them is a unanimous win, so the
  // gate is the only thing standing between this and a confident BETTER. A
  // budget change that clears the floor turns this red, which is the point:
  // background verdicts would then start reading as conclusive.
  it('gates a comparison at the background budget, however clear it looks', () => {
    const { attemptsPerCase, maxCases } = DEFAULT_JUDGE_CONFIG.background
    expect(maxCases).toBeDefined()
    const pairs = (maxCases ?? 0) * attemptsPerCase
    const judgments = Array.from({ length: pairs }, (_, i) =>
      judgment({ caseId: `case-${i}`, slotMap: X_IS_CANDIDATE, verdict: 'X' }),
    )
    const result = score(judgments, {
      orderSwap: { enabled: false, fraction: 0 },
    })
    expect(result.overall.delta).toBe(1)
    expect(result.label).toBe("CAN'T SAY")
    expect(result.labelNote).toMatch(/below the floor of 20/)
  })

  it('gates below the case-count floor whatever the delta says', () => {
    const judgments = Array.from({ length: 5 }, (_, i) =>
      judgment({ caseId: `case-${i}`, slotMap: X_IS_CANDIDATE, verdict: 'X' }),
    )
    const result = score(judgments, {
      orderSwap: { enabled: false, fraction: 0 },
    })
    expect(result.overall.delta).toBe(1)
    expect(result.label).toBe("CAN'T SAY")
    expect(result.labelNote).toMatch(/below the floor of 20/)
  })

  // An ungraded judgment is a judge failure. It has to be countable apart
  // from cannot_determine, which is a real thing the judge said about a
  // real comparison.
  it('counts a judge failure as ungraded, not as cannot_determine', () => {
    const result = score(
      [
        judgment({ caseId: 'a', slotMap: X_IS_CANDIDATE, verdict: 'X' }),
        {
          kind: 'ungraded',
          key: { caseId: 'b', attempt: 1, order: 'primary' },
          reason: 'boom',
        },
      ],
      noFloor(),
    )
    expect(result.exclusions.ungraded).toBe(1)
    expect(result.overall.cannotDetermine).toBe(0)
    expect(result.overall.cases).toBe(1)
  })
})

describe('labels', () => {
  const uniform = (verdict: SlotVerdict, n = 25): GradedJudgment[] =>
    Array.from({ length: n }, (_, i) =>
      judgment({ caseId: `case-${i}`, slotMap: X_IS_CANDIDATE, verdict }),
    )

  it('says BETTER when the whole interval is above zero', () => {
    expect(score(uniform('X'), noFloor()).label).toBe('BETTER')
  })

  it('says WORSE when the whole interval is below zero', () => {
    expect(score(uniform('Y'), noFloor()).label).toBe('WORSE')
  })

  // SAME is an affirmative finding of equivalence, which is a stronger
  // claim than "the difference was not significant".
  it('says SAME only when the whole interval sits inside the margin', () => {
    const result = score(uniform('tie'), noFloor())
    expect(result.label).toBe('SAME')
    expect(result.overall.delta).toBe(0)
  })

  // Every case scores exactly +0.5 (one win, one tie), so the interval
  // collapses onto the point estimate: the effect is unmistakably real and
  // still smaller than a margin of 0.6. That is a CAN'T SAY that has to say
  // why, or it reads as noise.
  const halfWins = (): GradedJudgment[] =>
    Array.from({ length: 25 }, (_, i) => i).flatMap((i) => [
      judgment({
        caseId: `case-${i}`,
        attempt: 1,
        slotMap: X_IS_CANDIDATE,
        verdict: 'X',
      }),
      judgment({
        caseId: `case-${i}`,
        attempt: 2,
        slotMap: X_IS_CANDIDATE,
        verdict: 'tie',
      }),
    ])

  it("calls a real effect below the margin CAN'T SAY, and says why", () => {
    const result = score(
      halfWins(),
      noFloor({
        gates: {
          ...DEFAULT_JUDGE_CONFIG.gates,
          minCases: 1,
          practicalMargin: 0.6,
        },
      }),
    )
    expect(result.overall.delta).toBeCloseTo(0.5, 10)
    expect(result.overall.interval).toEqual({ lower: 0.5, upper: 0.5 })
    expect(result.label).toBe("CAN'T SAY")
    expect(result.labelNote).toBe('real but below the practical margin')
  })

  // The margin is the only thing that changed between these two, which is
  // what "every tunable is a file edit" has to mean in practice.
  it('turns the same data into BETTER at a smaller margin', () => {
    const result = score(
      halfWins(),
      noFloor({
        gates: {
          ...DEFAULT_JUDGE_CONFIG.gates,
          minCases: 1,
          practicalMargin: 0.1,
        },
      }),
    )
    expect(result.label).toBe('BETTER')
  })

  it('names a regressed dimension without changing the label', () => {
    const judgments = Array.from({ length: 25 }, (_, i) => {
      const base = judgment({
        caseId: `case-${i}`,
        slotMap: X_IS_CANDIDATE,
        verdict: 'X',
      })
      return {
        ...base,
        dimensions: {
          ...base.dimensions,
          user_utility: {
            verdict: 'Y' as const,
            magnitude: 'clear' as const,
            seatsAgreed: true,
            directionConflict: false,
          },
        },
      }
    })
    const result = score(judgments, noFloor())
    expect(result.label).toBe('BETTER')
    expect(result.regressions).toEqual(['user_utility'])
  })
})

describe('the panel gate', () => {
  const disagreeing = (n: number): GradedJudgment[] =>
    Array.from({ length: n }, (_, i) => {
      const base = judgment({
        caseId: `case-${i}`,
        slotMap: X_IS_CANDIDATE,
        verdict: 'X',
      })
      return {
        ...base,
        dimensions: {
          ...base.dimensions,
          [OVERALL]: {
            verdict: 'X' as const,
            magnitude: 'clear' as const,
            seatsAgreed: i < 15,
            directionConflict: i >= 15,
          },
        },
      }
    })

  it('is not applied with a single seat', () => {
    const result = score(disagreeing(25), noFloor())
    expect(result.panelDisagreementRate).toBeNull()
    expect(result.label).toBe('BETTER')
  })

  it('gates when seats disagree on direction too often', () => {
    const result = score(
      disagreeing(25),
      noFloor({ panel: { seats: ['a', 'b', 'c'], temperature: 0 } }),
    )
    expect(result.panelDisagreementRate).toBeCloseTo(10 / 25, 10)
    expect(result.label).toBe("CAN'T SAY")
    expect(result.labelNote).toMatch(/seats disagreed/)
  })
})

describe('flags and the absolute floor', () => {
  // A flag says "X did this", and X is a different arm in the next
  // judgment. Counting without orienting would attribute half of them to
  // the wrong branch.
  it('orients a flag with the slot map of its own judgment', () => {
    const flag = {
      run: 'X' as const,
      type: 'restricted_data',
      explanation: 'named a voter',
      loc: 'X.final',
    }
    const result = score(
      [
        judgment({
          caseId: 'a',
          slotMap: X_IS_CANDIDATE,
          verdict: 'tie',
          flags: [flag],
        }),
        judgment({
          caseId: 'b',
          slotMap: X_IS_BASE,
          verdict: 'tie',
          flags: [flag],
        }),
      ],
      noFloor(),
    )
    expect(result.flags.map((f) => f.arm).sort()).toEqual(['base', 'candidate'])
  })

  // `combineFloor` produces `unclear` when no seat said `no` and at least one
  // was uncertain. It used to reach scoring and contribute nothing, so the
  // report never fired on it; folding it into the failure count instead would
  // blend "would not accept this" with "could not tell".
  it('reports an unclear floor, and not as a failure', () => {
    const result = score(
      [
        judgment({
          caseId: 'a',
          slotMap: X_IS_CANDIDATE,
          verdict: 'tie',
          floor: { X_acceptable: 'unclear', Y_acceptable: 'yes' },
        }),
      ],
      noFloor(),
    )
    expect(result.floorFailures).toEqual([])
    expect(result.floorUnclear).toEqual([{ arm: 'candidate', caseId: 'a' }])
  })

  // One seat calling a run unacceptable is not softened by another being
  // unsure about the same run, so the same arm and case must not appear in
  // both lists.
  it('lets a floor failure win over an unclear one on the same run', () => {
    const result = score(
      [
        judgment({
          caseId: 'a',
          slotMap: X_IS_CANDIDATE,
          verdict: 'tie',
          floor: { X_acceptable: 'unclear', Y_acceptable: 'yes' },
        }),
        judgment({
          caseId: 'a',
          order: 'swapped',
          slotMap: X_IS_BASE,
          verdict: 'tie',
          floor: { X_acceptable: 'yes', Y_acceptable: 'no' },
        }),
      ],
      noFloor(),
    )
    expect(result.floorFailures).toEqual([{ arm: 'candidate', caseId: 'a' }])
    expect(result.floorUnclear).toEqual([])
  })

  it('orients a floor failure the same way', () => {
    const result = score(
      [
        judgment({
          caseId: 'a',
          slotMap: X_IS_CANDIDATE,
          verdict: 'tie',
          floor: { X_acceptable: 'no', Y_acceptable: 'yes' },
        }),
      ],
      noFloor(),
    )
    expect(result.floorFailures).toEqual([{ arm: 'candidate', caseId: 'a' }])
  })

  // The order-swap subsample judges the same pair in both orders, so a
  // floor kept per judgment reports one broken run as two.
  it('counts one floor failure per arm and case, not per judgment', () => {
    const result = score(
      [
        judgment({
          caseId: 'a',
          slotMap: X_IS_CANDIDATE,
          verdict: 'tie',
          floor: { X_acceptable: 'no', Y_acceptable: 'yes' },
        }),
        judgment({
          caseId: 'a',
          order: 'swapped',
          slotMap: X_IS_BASE,
          verdict: 'tie',
          floor: { X_acceptable: 'yes', Y_acceptable: 'no' },
        }),
      ],
      noFloor(),
    )
    expect(result.floorFailures).toEqual([{ arm: 'candidate', caseId: 'a' }])
  })
})

describe('the measured layer', () => {
  const withTokens = (
    record: RunRecord,
    input: number,
    storedUsd: number,
  ): RunRecord => ({
    ...record,
    telemetry: {
      ...record.telemetry,
      tokens: { input, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: {
        usdAtCapture: storedUsd,
        pricingVersion: record.telemetry.cost?.pricingVersion ?? '2026-09',
      },
    },
  })

  // Never compare cost.usdAtCapture. A cached base arm can predate its
  // candidate by months, so the stored figures measure the price list as
  // much as the branch. Here the stored numbers are deliberately absurd.
  it('re-derives cost from tokens and ignores the stored dollars', () => {
    const agent = normalizeAgent(
      [withTokens(BASE, 10_000, 99), withTokens(CANDIDATE, 20_000, 1)],
      () => 0,
    )
    const result = score([], noFloor(), agent)
    // 10k and 20k input tokens at $3/M.
    expect(result.evidence.costUsd?.base).toBeCloseTo(0.03, 10)
    expect(result.evidence.costUsd?.candidate).toBeCloseTo(0.06, 10)
    expect(result.evidence.costUsd?.delta).toBeCloseTo(0.03, 10)
  })

  it('reports a pricing-version mismatch between the arms', () => {
    const stale = (record: RunRecord): RunRecord => ({
      ...record,
      telemetry: {
        ...record.telemetry,
        cost: { ...costOf(record), pricingVersion: '2025-01' },
      },
    })
    const matched = normalizeAgent([BASE, CANDIDATE], () => 0)
    const mixed = normalizeAgent([stale(BASE), CANDIDATE], () => 0)
    expect(score([], noFloor(), matched).evidence.pricingMismatch).toBe(false)
    expect(score([], noFloor(), mixed).evidence.pricingMismatch).toBe(true)
  })

  // Every other figure in the measured layer runs over the pairs that
  // produced a result on both arms, and this one has to as well: a pair
  // whose arm died in infra was never measured, so flagging its price
  // tables would report a mismatch about a comparison nobody made.
  it('ignores a pair that was never measured', () => {
    const stale = (record: RunRecord): RunRecord => ({
      ...record,
      telemetry: {
        ...record.telemetry,
        cost: { ...costOf(record), pricingVersion: '2025-01' },
      },
    })
    const [base, candidate] = INFRA_ERROR_PAIR
    const agent = normalizeAgent([stale(base), candidate], () => 0)
    expect(score([], noFloor(), agent).evidence.pairs).toBe(0)
    expect(score([], noFloor(), agent).evidence.pricingMismatch).toBe(false)
  })

  // A model with no rates on record must not be costed at zero, and must
  // not take the verdict down with it either.
  it('reports cost as not derivable rather than throwing', () => {
    const unknownModel = (record: RunRecord): RunRecord => ({
      ...record,
      variant: { ...record.variant, model: 'some-unreleased-model' },
    })
    const agent = normalizeAgent(
      [unknownModel(BASE), unknownModel(CANDIDATE)],
      () => 0,
    )
    const result = score([], noFloor(), agent)
    expect(result.evidence.costUsd).toBeNull()
    expect(result.evidence.unpriceableReason).toMatch(/some-unreleased-model/)
    // The verdict survived.
    expect(result.label).toBe("CAN'T SAY")
  })

  // A run that died has a timeout for a latency, which would swamp the
  // mean. A tool error is different: the run finished, and the tool-error
  // delta is exactly the kind of thing worth surfacing.
  it('measures over pairs that produced a result on both arms', () => {
    const toolError = normalizeAgent(TOOL_ERROR_PAIR, () => 0)
    const infra = normalizeAgent(INFRA_ERROR_PAIR, () => 0)
    expect(score([], noFloor(), toolError).evidence.pairs).toBe(1)
    expect(score([], noFloor(), infra).evidence.pairs).toBe(0)
    expect(
      score([], noFloor(), toolError).evidence.toolErrors.delta,
    ).toBeCloseTo(1, 10)
  })

  // The report prints this as "N case(s) used native web search", so an
  // attempt-pair count reads as three times the number of cases the rest
  // of the score was computed over.
  it('counts cases that saw the live web, not attempt-pairs', () => {
    const live = (record: RunRecord, attempt: number): RunRecord => ({
      ...record,
      attempt,
      runId: `${record.runId}-${attempt}`,
      liveWeb: true,
    })
    const agent = normalizeAgent(
      [1, 2, 3].flatMap((attempt) => [
        live(BASE, attempt),
        live(CANDIDATE, attempt),
      ]),
      () => 0,
    )
    expect(score([], noFloor(), agent).evidence.liveWebCases).toBe(1)
  })
})

describe('exclusion counts', () => {
  it('counts tool errors, infra errors and unpaired records apart', () => {
    const agent: NormalizedAgent = {
      ...normalizeAgent(BLOCKED_PAIR, () => 0),
      excluded: [
        ...normalizeAgent(TOOL_ERROR_PAIR, () => 0).excluded,
        ...normalizeAgent(INFRA_ERROR_PAIR, () => 0).excluded,
      ],
      unpaired: normalizeAgent([BASE], () => 0).unpaired,
    }
    const result = score([], noFloor(), agent)
    expect(result.exclusions).toEqual({
      ungradedReasons: [],
      toolError: 1,
      infraError: 1,
      identicalConfig: 0,
      unpaired: 1,
      ungraded: 0,
      toolErrorCauses: [
        {
          tool: 'query_constituent_data',
          errorClass: 'PeopleDbxUnavailableError',
          pairs: 1,
          arms: ['candidate'],
        },
      ],
    })
  })
})

describe('provenance', () => {
  it('carries the CI context through so a verdict links to the change', () => {
    const agent = normalizeAgent([BASE, CANDIDATE], () => 0)
    expect(score([], noFloor(), agent).ci).toMatchObject({
      repo: 'thegoodparty/omni',
      prNumber: 2198,
    })
  })

  it('has no CI context for a local run', () => {
    const agent = normalizeAgent(BLOCKED_PAIR, () => 0)
    expect(score([], noFloor(), agent).ci).toBeNull()
  })

  it('keeps the agent it scored, because a delta is never blended', () => {
    const result = score([], noFloor())
    expect(result.agentId).toBe('chief_of_staff')
    expect(result.shape).toBe('chat')
  })
})

describe('slot vocabulary', () => {
  // `blindCase` destructures the blinded runs into exactly two, and
  // `orient` maps a slot straight through the slot map, so a third slot
  // would break both silently. Pinned against the real SLOTS rather than a
  // local copy of it, which would assert nothing.
  it('is exactly X and Y', () => {
    expect(SLOTS).toEqual(['X', 'Y'])
  })
})

// judge.ts has always collected which seats threw. For most of this
// feature's life nothing read it, so a 429 on one seat of a multi-seat panel
// quietly reduced the panel to the survivors and the verdict was reported as
// though every seat had agreed.
describe('a panel that lost a seat', () => {
  const lost = (caseId: string, models: readonly string[]): JudgmentSpec => ({
    caseId,
    slotMap: X_IS_CANDIDATE,
    verdict: 'X',
    seatFailures: models.map((model) => ({
      model,
      message: 'rate limited',
    })),
  })

  it('reports nothing at all when every judgment had every seat', () => {
    const result = score(
      [
        judgment({ caseId: 'a', slotMap: X_IS_CANDIDATE, verdict: 'X' }),
        judgment({ caseId: 'b', slotMap: X_IS_CANDIDATE, verdict: 'X' }),
      ],
      noFloor(),
    )
    expect(result.degradedPanel).toBeNull()
  })

  it('counts the judgments it touched and names the seats it lost', () => {
    const result = score(
      [
        judgment(lost('a', ['seat-two'])),
        judgment({ caseId: 'b', slotMap: X_IS_CANDIDATE, verdict: 'X' }),
        judgment(lost('c', ['seat-two'])),
      ],
      noFloor(),
    )
    expect(result.degradedPanel).toEqual({
      judgments: 2,
      seats: ['seat-two'],
    })
  })

  // The count is verdicts affected, not seats lost. Two seats failing on one
  // judgment is one degraded verdict, and a reader who saw "2" would go
  // looking for a second case that does not exist.
  it('counts a judgment once however many of its seats threw', () => {
    const result = score([judgment(lost('a', ['b', 'c']))], noFloor())
    expect(result.degradedPanel?.judgments).toBe(1)
  })

  it('names each seat once, sorted, across every judgment', () => {
    const result = score(
      [judgment(lost('a', ['zeta', 'alpha'])), judgment(lost('b', ['zeta']))],
      noFloor(),
    )
    expect(result.degradedPanel?.seats).toEqual(['alpha', 'zeta'])
  })

  // A judgment whose every seat failed came back `ungraded`, which the
  // report already surfaces through exclusions. Counting it here too would
  // report one failure twice and hide the case this exists for.
  it('is not raised by a judgment that lost its whole panel', () => {
    const result = score(
      [
        {
          kind: 'ungraded',
          key: { caseId: 'a', attempt: 1, order: 'primary' },
          reason: 'b: rate limited',
        },
      ],
      noFloor(),
    )
    expect(result.degradedPanel).toBeNull()
    expect(result.exclusions.ungraded).toBe(1)
  })
})

// A COUNT IS NOT ACTIONABLE. The first live sweep reported "29 ungraded
// judgment(s)" and nothing else, and recovering the cause meant reproducing
// the whole run — the one thing a report exists to make unnecessary. The
// reasons are already on the judgments, so carrying them costs nothing.
describe('ungraded reasons reach the score', () => {
  const ungraded = (caseId: string, reason: string): Judgment => ({
    kind: 'ungraded',
    key: { caseId, attempt: 1, order: 'primary' },
    reason,
  })

  const agent = (): NormalizedAgent => normalizeAgent(CHAT_PAIR, () => 0)

  it('carries the reason, not only the count', () => {
    const result = score(
      [ungraded('a', 'seat claude-sonnet-4-6 returned no verdict')],
      noFloor(),
      agent(),
    )
    expect(result.exclusions.ungraded).toBe(1)
    expect(result.exclusions.ungradedReasons).toEqual([
      'seat claude-sonnet-4-6 returned no verdict',
    ])
  })

  // Deduplicated, because the failure that matters is "every seat threw the
  // same sentence" and printing it 29 times buries the report.
  it('deduplicates one reason repeated across every pair', () => {
    const same = 'seat claude-sonnet-4-6 returned no verdict'
    const result = score(
      [ungraded('a', same), ungraded('b', same), ungraded('c', same)],
      noFloor(),
      agent(),
    )
    expect(result.exclusions.ungraded).toBe(3)
    expect(result.exclusions.ungradedReasons).toEqual([same])
  })

  it('keeps two different reasons apart', () => {
    const result = score(
      [ungraded('a', 'rate limited'), ungraded('b', 'no verdict')],
      noFloor(),
      agent(),
    )
    expect(result.exclusions.ungradedReasons).toEqual([
      'rate limited',
      'no verdict',
    ])
  })

  it('is empty when nothing was ungraded', () => {
    const result = score([], noFloor(), agent())
    expect(result.exclusions.ungradedReasons).toEqual([])
  })
})

// A COUNT WITHOUT A CAUSE. Two live sweeps excluded every pair for a tool
// error and said only how many; naming the tool took a diagnostic branch.
//
// The records here are background-shaped, so their pairs are SCORED rather
// than excluded and the causes land in `scoredToolErrorCauses`. The grouping
// is the same function either way; the chat case below pins the other list.
describe('tool error causes', () => {
  const TRACEBACK =
    "Exit code 1\nTraceback (most recent call last):\nKeyError: 'PARAMS_JSON'"

  const failing = (
    record: RunRecord,
    caseId: string,
    details?: RunRecord['toolErrorDetails'],
  ): RunRecord => ({
    ...record,
    agentShape: 'background',
    caseId,
    runId: `${record.arm}_${caseId}`,
    telemetry: { ...record.telemetry, toolCalls: 1, toolErrors: 1 },
    ...(details && { toolErrorDetails: details }),
  })
  const clean = (record: RunRecord, caseId: string): RunRecord => ({
    ...record,
    agentShape: 'background',
    caseId,
    runId: `${record.arm}_${caseId}`,
  })
  const params = [{ tool: 'Bash', message: TRACEBACK }]

  it('groups by tool and error class, counting pairs and naming arms', () => {
    const agent = normalizeAgent(
      [
        failing(BASE, 'a', params),
        failing(CANDIDATE, 'a', params),
        failing(BASE, 'b', params),
        failing(CANDIDATE, 'b', params),
        clean(BASE, 'c'),
        failing(CANDIDATE, 'c', [{ tool: 'Bash', message: 'boom' }]),
        // Written before the field existed: a count and no detail.
        failing(BASE, 'd'),
        clean(CANDIDATE, 'd'),
      ],
      () => 0,
    )

    const result = score([], noFloor(), agent)
    // None of these pairs was excluded: a background tool error is evidence
    // beside the verdict, not a reason to drop the pair.
    expect(result.exclusions.toolError).toBe(0)
    expect(result.exclusions.toolErrorCauses).toEqual([])
    expect(result.scoredToolErrorCauses).toEqual([
      {
        tool: 'Bash',
        errorClass: 'KeyError',
        pairs: 2,
        arms: ['base', 'candidate'],
      },
      { tool: 'Bash', errorClass: 'other', pairs: 1, arms: ['candidate'] },
      {
        tool: 'unknown',
        errorClass: 'unrecorded',
        pairs: 1,
        arms: ['base'],
      },
    ])
  })

  // A background tool name is whatever the model emitted. One it invented
  // can be a person's name, and a failing call to it would print that name.
  it('never carries a tool name outside the allowlist', () => {
    const invented = [
      'Jane Smith <b>',
      'lookup_jane_doe',
      'mcp__broker__jane_doe',
      'mcp__broker__GET_jane doe',
      'mcp__broker__GET_jane_doe_voter_record',
      'jane_doe_mcp__broker__GET_x',
    ]
    const agent = normalizeAgent(
      invented.flatMap((tool, i) => [
        failing(BASE, `t${i}`, [{ tool, message: 'boom' }]),
        clean(CANDIDATE, `t${i}`),
      ]),
      () => 0,
    )
    expect(
      score([], noFloor(), agent).scoredToolErrorCauses.map((c) => c.tool),
    ).toEqual(['unknown'])
  })

  it('keeps a broker tool and a registered chat tool', () => {
    const agent = normalizeAgent(
      [
        failing(BASE, 'a', [
          { tool: 'mcp__broker__GET_community_issues', message: 'boom' },
        ]),
        clean(CANDIDATE, 'a'),
        {
          ...failing(BASE, 'b', [
            { tool: 'query_constituent_data', message: 'boom' },
          ]),
          agentShape: 'chat',
        },
        { ...clean(CANDIDATE, 'b'), agentShape: 'chat' },
        // A built-in name on a chat record is not a chat tool.
        {
          ...failing(BASE, 'c', [{ tool: 'Bash', message: 'x' }]),
          agentShape: 'chat',
        },
        { ...clean(CANDIDATE, 'c'), agentShape: 'chat' },
      ],
      () => 0,
    )
    const result = score([], noFloor(), agent)
    expect(
      [...result.exclusions.toolErrorCauses, ...result.scoredToolErrorCauses]
        .map((c) => c.tool)
        .sort(),
    ).toEqual([
      'mcp__broker__GET_community_issues',
      'query_constituent_data',
      'unknown',
    ])
  })

  it('is empty when nothing was excluded for a tool error', () => {
    const agent = normalizeAgent(CHAT_PAIR, () => 0)
    expect(score([], noFloor(), agent).exclusions.toolErrorCauses).toEqual([])
    expect(score([], noFloor(), agent).scoredToolErrorCauses).toEqual([])
  })

  // Chat keeps the old rule: its tool-error pair is excluded, so its cause is
  // an exclusion cause and never a scored one.
  it('keeps a chat tool error in the exclusion list only', () => {
    const result = score(
      [],
      noFloor(),
      normalizeAgent(TOOL_ERROR_PAIR, () => 0),
    )
    expect(result.exclusions.toolError).toBe(1)
    expect(result.exclusions.toolErrorCauses.map((c) => c.tool)).toEqual([
      'query_constituent_data',
    ])
    expect(result.scoredToolErrorCauses).toEqual([])
  })

  // The decision this rests on: a background pair whose arms hit a failing
  // Bash snippet and recovered is judged on its artifact, and what failed is
  // still measured and named beside the verdict.
  it('scores a background tool-error pair and still measures it', () => {
    const result = score(
      [],
      noFloor(),
      normalizeAgent(BACKGROUND_TOOL_ERROR_PAIR, () => 0),
    )
    expect(result.exclusions.toolError).toBe(0)
    expect(result.evidence.pairs).toBe(1)
    expect(result.evidence.toolErrors).toEqual({
      base: 2,
      candidate: 1,
      delta: -1,
    })
    expect(result.scoredToolErrorCauses).toEqual([
      {
        tool: 'Bash',
        errorClass: 'exit code 1',
        pairs: 1,
        arms: ['base', 'candidate'],
      },
      { tool: 'Bash', errorClass: 'ValueError', pairs: 1, arms: ['base'] },
    ])
  })
})
