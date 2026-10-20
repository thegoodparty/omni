import { describe, expect, it } from 'vitest'
import { DEFAULT_JUDGE_CONFIG } from './config'
import type { CaseHandling, ConditionHandling, HandlingClass } from './handling'
import {
  combineVerdict,
  handlingSignal,
  signTestTail,
  toolSignal,
  withRegressionSignals,
} from './regressionSignals'
import type { AgentScore } from './score'
import type { AgentToolUse, ArmToolUse, CaseToolUse } from './toolUse'

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

const arm = (
  runs: number,
  tools: Record<string, [called: number, errored: number]>,
): ArmToolUse => ({
  runs,
  infraErrors: 0,
  tools: Object.fromEntries(
    Object.entries(tools).map(([name, [called, errored]]) => [
      name,
      { called, errored },
    ]),
  ),
})

const toolCase = (
  caseId: string,
  base: ArmToolUse,
  candidate: ArmToolUse,
): CaseToolUse => ({ caseId, base, candidate })

const agentToolUse = (cases: CaseToolUse[]): AgentToolUse => ({
  agentId: 'priority_flow',
  cases,
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
    toolError: 0,
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

describe('toolSignal', () => {
  it('says WORSE when two cases fail on the candidate only', () => {
    const signal = toolSignal(
      agentToolUse([
        toolCase(
          'a',
          arm(3, { count_contacts: [3, 0] }),
          arm(3, { count_contacts: [3, 3] }),
        ),
        toolCase(
          'b',
          arm(3, { update_priority_status: [3, 0] }),
          arm(3, { update_priority_status: [2, 2] }),
        ),
      ]),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal.says).toBe('WORSE')
    expect(signal.cases.map((c) => c.candidateOnlyFailures)).toEqual([
      ['count_contacts'],
      ['update_priority_status'],
    ])
  })

  it('says nothing for one such case, or for failures the base shares', () => {
    const signal = toolSignal(
      agentToolUse([
        toolCase(
          'a',
          arm(3, { count_contacts: [3, 0] }),
          arm(3, { count_contacts: [3, 3] }),
        ),
        toolCase(
          'b',
          arm(3, { count_contacts: [3, 1] }),
          arm(3, { count_contacts: [3, 3] }),
        ),
        toolCase(
          'c',
          arm(3, { count_contacts: [3, 0] }),
          arm(3, { count_contacts: [3, 1] }),
        ),
      ]),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal.says).toBeNull()
    expect(signal.cases.map((c) => c.caseId)).toEqual(['a'])
  })

  it('says BETTER when the base alone failed in two cases', () => {
    const signal = toolSignal(
      agentToolUse([
        toolCase('a', arm(3, { lookup: [3, 2] }), arm(3, { lookup: [3, 0] })),
        toolCase('b', arm(3, { lookup: [3, 3] }), arm(3, { lookup: [3, 0] })),
      ]),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal.says).toBe('BETTER')
  })

  it('reports dropped and added tools without deciding anything', () => {
    const signal = toolSignal(
      agentToolUse([
        toolCase(
          'outreach-explicit-text',
          arm(3, {
            present_outreach_proposal: [2, 0],
            size_outreach_sample: [3, 0],
          }),
          arm(3, {}),
        ),
        toolCase(
          'judgement-who-to-hear-from',
          arm(3, { update_priority_status: [3, 0] }),
          arm(3, { count_contacts: [2, 0] }),
        ),
        toolCase(
          'once-only',
          arm(3, { update_priority_status: [1, 0] }),
          arm(3, {}),
        ),
      ]),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal.says).toBeNull()
    expect(signal.cases).toEqual([
      {
        caseId: 'outreach-explicit-text',
        candidateOnlyFailures: [],
        baseOnlyFailures: [],
        dropped: ['present_outreach_proposal', 'size_outreach_sample'],
        added: [],
      },
      {
        caseId: 'judgement-who-to-hear-from',
        candidateOnlyFailures: [],
        baseOnlyFailures: [],
        dropped: ['update_priority_status'],
        added: ['count_contacts'],
      },
    ])
  })

  it('counts a failure only on a tool both arms called', () => {
    const signal = toolSignal(
      agentToolUse([
        toolCase('a', arm(3, { lookup: [3, 3] }), arm(3, {})),
        toolCase('b', arm(3, { lookup: [2, 2] }), arm(3, {})),
        toolCase('c', arm(3, {}), arm(3, { read_issue: [3, 3] })),
        toolCase('d', arm(3, {}), arm(3, { read_issue: [2, 2] })),
      ]),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal.says).toBeNull()
    expect(
      signal.cases.map((c) => [
        c.caseId,
        c.candidateOnlyFailures,
        c.baseOnlyFailures,
        c.dropped,
        c.added,
      ]),
    ).toEqual([
      ['a', [], [], ['lookup'], []],
      ['b', [], [], ['lookup'], []],
      ['c', [], [], [], ['read_issue']],
      ['d', [], [], [], ['read_issue']],
    ])
  })

  it('skips a case one arm never ran', () => {
    const signal = toolSignal(
      agentToolUse([
        toolCase('new-1', arm(0, {}), arm(3, { lookup: [3, 3] })),
        toolCase('new-2', arm(0, {}), arm(3, { lookup: [3, 3] })),
      ]),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal).toEqual({ cases: [], says: null })
  })

  it('prints a name not shaped like a registered tool as unknown', () => {
    const signal = toolSignal(
      agentToolUse([
        toolCase('a', arm(3, { 'Not A Tool': [3, 0] }), arm(3, {})),
      ]),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(signal.cases[0]?.dropped).toEqual(['unknown'])
  })
})

describe('combineVerdict', () => {
  it('lets any signal saying WORSE win', () => {
    expect(combineVerdict("CAN'T SAY", ['WORSE', null])).toBe('WORSE')
    expect(combineVerdict('BETTER', [null, 'WORSE'])).toBe('WORSE')
    expect(combineVerdict('SAME', ['BETTER', 'WORSE'])).toBe('WORSE')
    expect(combineVerdict('WORSE', ['BETTER', null])).toBe('WORSE')
  })

  it('says BETTER when something does and nothing says WORSE', () => {
    expect(combineVerdict("CAN'T SAY", [null, 'BETTER'])).toBe('BETTER')
    expect(combineVerdict('SAME', ['BETTER', null])).toBe('BETTER')
    expect(combineVerdict('BETTER', [null, null])).toBe('BETTER')
  })

  it('keeps the quality label when no signal speaks', () => {
    expect(combineVerdict("CAN'T SAY", [null, null])).toBe("CAN'T SAY")
    expect(combineVerdict('SAME', [])).toBe('SAME')
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
      undefined,
      DEFAULT_JUDGE_CONFIG,
    )
    expect(result.label).toBe('WORSE')
    expect(result.signals?.qualityLabel).toBe("CAN'T SAY")
    expect(result.signals?.handling?.says).toBe('WORSE')
    expect(result.signals?.tools).toBeUndefined()
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
      agentToolUse([
        toolCase(
          'a',
          arm(3, { count_contacts: [3, 1] }),
          arm(3, { count_contacts: [3, 0] }),
        ),
      ]),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(result.label).toBe('SAME')
    expect(result.signals?.tools).toEqual({ cases: [], says: null })
  })

  it('reads no tool signal for a background agent', () => {
    const result = withRegressionSignals(
      { ...SCORE, shape: 'background' },
      agentToolUse([]),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(result.signals).toEqual({ qualityLabel: "CAN'T SAY" })
  })
})
