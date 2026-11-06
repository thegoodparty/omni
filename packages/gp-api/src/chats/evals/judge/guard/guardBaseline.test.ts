import { describe, expect, it } from 'vitest'
import { OVERALL, type GradedJudgment, type Judgment } from '../judge'
import {
  baselineKey,
  buildGuardBaseline,
  formatGuardBaselineTrailer,
  isFlakyOnMain,
  isGuardBaselineRefusal,
  regressedCaseIds,
  type GuardBaseline,
  type GuardBaselineCase,
} from './guardBaseline'

const SLOT_MAP = { X: 'base', Y: 'candidate' } as const

const graded = (
  caseId: string,
  attempt: number,
  order: 'primary' | 'swapped',
  handled:
    | { X: 'yes' | 'partly' | 'no'; Y: 'yes' | 'partly' | 'no' }
    | undefined,
  verdict: 'X' | 'Y' | 'tie' | 'cannot_determine' = 'tie',
): GradedJudgment => ({
  kind: 'graded',
  key: { caseId, attempt, order },
  slotMap: SLOT_MAP,
  dimensions: {
    [OVERALL]: {
      verdict,
      magnitude: null,
      seatsAgreed: true,
      directionConflict: false,
    },
  },
  seats: [],
  seatFailures: [],
  flags: [],
  absoluteFloor: null,
  ...(handled !== undefined && { handled }),
})

describe('baselineKey', () => {
  it('builds the documented path under the role-granted prefix', () => {
    expect(baselineKey('chief_of_staff')).toBe(
      '_judge/guard/baselines/chief_of_staff.json',
    )
  })
})

describe('buildGuardBaseline', () => {
  it('refuses when the two arms did not run the same code', () => {
    const result = buildGuardBaseline({
      runId: '123',
      agentId: 'chief_of_staff',
      date: '2026-11-05T00:00:00.000Z',
      codeIdentical: false,
      judgments: [],
      controlCaseIds: new Set(),
    })
    expect(isGuardBaselineRefusal(result)).toBe(true)
    if (isGuardBaselineRefusal(result)) {
      expect(result.reason).toMatch(/did not run the same code/)
    }
  })

  it('counts each case’s handled-when pass count per arm across attempts', () => {
    const judgments: Judgment[] = [
      graded('case-a', 1, 'primary', { X: 'yes', Y: 'yes' }),
      graded('case-a', 2, 'primary', { X: 'yes', Y: 'no' }),
      graded('case-a', 3, 'primary', { X: 'yes', Y: 'yes' }),
    ]
    const result = buildGuardBaseline({
      runId: '41973696104',
      agentId: 'campaign_assistant',
      date: '2026-11-05T00:00:00.000Z',
      codeIdentical: true,
      judgments,
      controlCaseIds: new Set(),
    })
    expect(isGuardBaselineRefusal(result)).toBe(false)
    const baseline = result as GuardBaseline
    expect(baseline.cases).toEqual([
      {
        caseId: 'case-a',
        attempts: 3,
        baseHandled: 3,
        candidateHandled: 2,
      },
    ])
  })

  it('counts a control pair as called only when the overall verdict is not a tie', () => {
    const judgments: Judgment[] = [
      graded('control-a', 1, 'primary', undefined, 'X'),
      graded('control-b', 1, 'primary', undefined, 'tie'),
      graded('control-c', 1, 'primary', undefined, 'cannot_determine'),
    ]
    const result = buildGuardBaseline({
      runId: '123',
      agentId: 'chief_of_staff',
      date: '2026-11-05T00:00:00.000Z',
      codeIdentical: true,
      judgments,
      controlCaseIds: new Set(['control-a', 'control-b', 'control-c']),
    })
    expect(isGuardBaselineRefusal(result)).toBe(false)
    const baseline = result as GuardBaseline
    expect(baseline.controlPairsCalled).toBe(1)
    expect(baseline.controlPairsTotal).toBe(3)
  })
})

describe('regressedCaseIds', () => {
  it('names a case the candidate stopped handling as moved', () => {
    const judgments: Judgment[] = [
      graded('case-a', 1, 'primary', { X: 'yes', Y: 'no' }),
    ]
    expect(regressedCaseIds(judgments)).toEqual(['case-a'])
  })

  it('does not name a case both arms handled', () => {
    const judgments: Judgment[] = [
      graded('case-a', 1, 'primary', { X: 'yes', Y: 'yes' }),
    ]
    expect(regressedCaseIds(judgments)).toEqual([])
  })

  it('does not name a case neither arm handled (a shared failure)', () => {
    const judgments: Judgment[] = [
      graded('case-a', 1, 'primary', { X: 'no', Y: 'no' }),
    ]
    expect(regressedCaseIds(judgments)).toEqual([])
  })

  it('deduplicates a case that regressed across more than one attempt', () => {
    const judgments: Judgment[] = [
      graded('case-a', 1, 'primary', { X: 'yes', Y: 'no' }),
      graded('case-a', 2, 'primary', { X: 'yes', Y: 'no' }),
    ]
    expect(regressedCaseIds(judgments)).toEqual(['case-a'])
  })

  it('sorts the moved case ids', () => {
    const judgments: Judgment[] = [
      graded('case-b', 1, 'primary', { X: 'yes', Y: 'no' }),
      graded('case-a', 1, 'primary', { X: 'yes', Y: 'no' }),
    ]
    expect(regressedCaseIds(judgments)).toEqual(['case-a', 'case-b'])
  })
})

describe('isFlakyOnMain', () => {
  const base = (over: Partial<GuardBaselineCase>): GuardBaselineCase => ({
    caseId: 'c',
    attempts: 3,
    baseHandled: 3,
    candidateHandled: 3,
    ...over,
  })

  it('marks a case flaky when it met on some but not all of the baseline’s runs', () => {
    expect(isFlakyOnMain(base({ baseHandled: 2, candidateHandled: 2 }))).toBe(
      true,
    )
  })

  it('does not mark a case flaky when it met on every baseline run', () => {
    expect(isFlakyOnMain(base({ baseHandled: 3, candidateHandled: 3 }))).toBe(
      false,
    )
  })

  it('marks a case flaky when the two identical arms disagreed outright', () => {
    expect(isFlakyOnMain(base({ baseHandled: 3, candidateHandled: 0 }))).toBe(
      true,
    )
  })
})

describe('formatGuardBaselineTrailer', () => {
  const baseline: GuardBaseline = {
    runId: '41973696104',
    agentId: 'campaign_assistant',
    date: '2026-11-05T00:00:00.000Z',
    cases: [
      { caseId: 'case-a', attempts: 3, baseHandled: 3, candidateHandled: 2 },
      { caseId: 'case-b', attempts: 3, baseHandled: 3, candidateHandled: 3 },
    ],
    controlPairsCalled: 1,
    controlPairsTotal: 2,
  }

  it('marks a 2-of-3 baseline case flaky and a 3-of-3 case not flaky', () => {
    const text = formatGuardBaselineTrailer([
      {
        agentId: 'campaign_assistant',
        movedCaseIds: ['case-a', 'case-b'],
        baseline,
      },
    ])
    const caseALine = text.split('\n').find((l) => l.includes('case-a'))
    const caseBLine = text.split('\n').find((l) => l.includes('case-b'))
    expect(caseALine).toMatch(/flaky on main/)
    expect(caseBLine).not.toMatch(/flaky on main/)
    expect(text).toContain('control pair(s)')
  })

  it('prints the documented line when there is no baseline for the agent', () => {
    const text = formatGuardBaselineTrailer([
      {
        agentId: 'opposition_research',
        movedCaseIds: ['case-x'],
        baseline: undefined,
      },
    ])
    expect(text).toContain('No main-vs-main baseline for opposition_research')
  })
})
