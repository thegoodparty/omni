import { describe, expect, it } from 'vitest'
import type { LabelDeclaration, LabeledCase } from '../cases'
import type { Arm, JsonValue, RunRecord } from '../record'
import { scoreLabeled, type LabeledScoreInput } from './score'
import type { LabelAnswer } from './types'

const LABELS: LabelDeclaration[] = [
  { name: 'optOut', type: 'boolean', floor: true },
  { name: 'civicPanelJoin', type: 'boolean' },
]

const labeledCase = (
  caseId: string,
  optOut: boolean,
  civicPanelJoin = false,
): LabeledCase => ({
  caseId,
  input: { text: `fictional reply ${caseId}`, channel: 'text' },
  expected: { optOut, civicPanelJoin },
})

const asJson = (labels: Record<string, LabelAnswer>): JsonValue => {
  const value: Record<string, JsonValue> = {}
  for (const [name, answer] of Object.entries(labels)) {
    value[name] =
      answer.probabilities === undefined
        ? { value: answer.value }
        : { value: answer.value, probabilities: answer.probabilities }
  }
  return value
}

const record = (
  caseId: string,
  arm: Arm,
  labels: Record<string, LabelAnswer> | null,
): RunRecord => ({
  schemaVersion: 1,
  sweepId: 'swp_labeled',
  runId: `swp_labeled:reply_intent:${caseId}:${arm}:1`,
  agentId: 'reply_intent',
  agentShape: 'labeled',
  arm,
  variant: {
    ref: arm,
    commit: arm === 'base' ? 'a'.repeat(40) : 'b'.repeat(40),
    model: 'regex',
    configDigest: 'labeled:x',
  },
  caseId,
  attempt: 1,
  startedAt: '2026-11-18T00:00:00.000Z',
  endedAt: '2026-11-18T00:00:00.001Z',
  input: { kind: 'labeled', value: { text: 'x', channel: 'text' } },
  output: labels === null ? null : { kind: 'labels', value: asJson(labels) },
  trace: [],
  telemetry: {
    latencyMs: 1,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    toolCalls: 0,
    toolErrors: 0,
    retries: 0,
  },
  toolQueries: [],
  liveWeb: false,
  status: labels === null ? 'infraError' : 'produced',
})

const hard = (optOut: boolean, civicPanelJoin = false) => ({
  optOut: { value: optOut },
  civicPanelJoin: { value: civicPanelJoin },
})

// Both arms' answers for one case, and the case itself.
const pairOf = (
  one: LabeledCase,
  base: Record<string, LabelAnswer> | null,
  candidate: Record<string, LabelAnswer> | null,
): RunRecord[] => [
  record(one.caseId, 'base', base),
  record(one.caseId, 'candidate', candidate),
]

const input = (
  cases: LabeledCase[],
  records: RunRecord[],
  over: Partial<LabeledScoreInput> = {},
): LabeledScoreInput => ({
  agentId: 'reply_intent',
  records,
  labels: LABELS,
  cases,
  unscoredCaseIds: new Set(),
  baseExpected: new Map(cases.map((one) => [one.caseId, one.expected])),
  ...over,
})

describe('scoreLabeled', () => {
  it('reads SAME when no case is right on one arm only', () => {
    const [a, b] = [labeledCase('a', true), labeledCase('b', false)]
    const cases = [a, b]
    const records = [
      ...pairOf(a, hard(true), hard(true)),
      ...pairOf(b, hard(true), hard(true)),
    ]
    const score = scoreLabeled(input(cases, records))
    expect(score.label).toBe('SAME')
    expect(score.pairedCases).toBe(2)
    expect(score.base.allCorrect).toBe(1)
    expect(score.candidate.allCorrect).toBe(1)
    expect(score.discordant).toEqual([])
    expect(score.sign).toBeNull()
  })

  // Five of five one way is p = 1/32, under 0.05; four of four is 1/16.
  it('reads BETTER on five discordant cases for the candidate', () => {
    const cases = Array.from({ length: 5 }, (_, i) =>
      labeledCase(`c${i}`, false, true),
    )
    const records = cases.flatMap((one) =>
      pairOf(one, hard(false, false), hard(false, true)),
    )
    const score = scoreLabeled(input(cases, records))
    expect(score.label).toBe('BETTER')
    expect(score.sign?.pBetter).toBeCloseTo(1 / 32)
    expect(score.discordant.map((d) => d.favours)).toEqual(
      Array(5).fill('candidate'),
    )
    expect(score.discordant[0]?.wrong).toEqual({
      base: ['civicPanelJoin'],
      candidate: [],
    })
  })

  it("reads CAN'T SAY on four discordant cases, and gives the count", () => {
    const cases = Array.from({ length: 4 }, (_, i) =>
      labeledCase(`c${i}`, false, true),
    )
    const records = cases.flatMap((one) =>
      pairOf(one, hard(false, false), hard(false, true)),
    )
    const score = scoreLabeled(input(cases, records))
    expect(score.label).toBe("CAN'T SAY")
    expect(score.labelNote).toContain('4 discordant case(s)')
  })

  it('reads WORSE on five discordant cases for the base', () => {
    const cases = Array.from({ length: 5 }, (_, i) =>
      labeledCase(`c${i}`, false, true),
    )
    const records = cases.flatMap((one) =>
      pairOf(one, hard(false, true), hard(false, false)),
    )
    expect(scoreLabeled(input(cases, records)).label).toBe('WORSE')
  })

  // The base arm caught an opt-out the candidate missed. One such case
  // decides, even with every other case going the candidate's way, and
  // even when the base was wrong to say true.
  it('reads WORSE on a single floor breach, whatever the count says', () => {
    const better = Array.from({ length: 6 }, (_, i) =>
      labeledCase(`c${i}`, false, true),
    )
    const breach = labeledCase('breach', false)
    const records = [
      ...better.flatMap((one) =>
        pairOf(one, hard(false, false), hard(false, true)),
      ),
      ...pairOf(breach, hard(true), hard(false)),
    ]
    const score = scoreLabeled(input([...better, breach], records))
    expect(score.sign?.pBetter).toBeLessThan(0.05)
    expect(score.label).toBe('WORSE')
    expect(score.floorBreaches).toEqual([{ caseId: 'breach', label: 'optOut' }])
  })

  it('applies the floor on a control too', () => {
    const one = labeledCase('control', true)
    const score = scoreLabeled(
      input([one], pairOf(one, hard(true), hard(false)), {
        unscoredCaseIds: new Set(['control']),
      }),
    )
    expect(score.floorBreaches).toEqual([
      { caseId: 'control', label: 'optOut' },
    ])
    expect(score.pairedCases).toBe(0)
    expect(score.unscored).toEqual(['control'])
  })

  it('applies no floor to a label that does not declare one', () => {
    const one = labeledCase('a', false, true)
    const score = scoreLabeled(
      input([one], pairOf(one, hard(false, true), hard(false, false))),
    )
    expect(score.floorBreaches).toEqual([])
  })

  it('excludes a case either arm has no readable answer for', () => {
    const failed = labeledCase('failed', true)
    const cases = [
      failed,
      labeledCase('missing', true),
      labeledCase('garbled', true),
    ]
    const garbled: RunRecord = {
      ...record('garbled', 'candidate', hard(true)),
      output: { kind: 'labels', value: 'not labels' },
    }
    const records = [
      ...pairOf(failed, hard(true), null),
      record('missing', 'candidate', hard(true)),
      record('garbled', 'base', hard(true)),
      garbled,
    ]
    const score = scoreLabeled(input(cases, records))
    expect(score.excluded).toEqual([
      { caseId: 'failed', arm: 'candidate', why: 'infraError' },
      { caseId: 'missing', arm: 'base', why: 'missing' },
      { caseId: 'garbled', arm: 'candidate', why: 'unreadable' },
    ])
    expect(score.pairedCases).toBe(0)
    expect(score.label).toBe("CAN'T SAY")
  })

  it('counts a label an arm left out as wrong', () => {
    const one = labeledCase('a', true)
    const score = scoreLabeled(
      input([one], pairOf(one, hard(true), { optOut: { value: true } })),
    )
    expect(score.candidate.labels).toEqual([
      { name: 'optOut', correct: 1, brier: 0 },
      { name: 'civicPanelJoin', correct: 0, brier: 1 },
    ])
  })

  // Hard labels count as probability 0 or 1, so a hard arm's Brier is its
  // error rate; a probabilistic arm is scored on its distribution.
  it('scores Brier from probabilities, and hard labels as 0 or 1', () => {
    const [a, b] = [labeledCase('a', true), labeledCase('b', false)]
    const cases = [a, b]
    const soft = (pTrue: number) => ({
      optOut: { value: pTrue >= 0.5, probabilities: { true: pTrue } },
      civicPanelJoin: {
        value: false,
        probabilities: { true: 0, false: 1 },
      },
    })
    const records = [
      ...pairOf(a, hard(true), soft(0.9)),
      ...pairOf(b, hard(true), soft(0.2)),
    ]
    const score = scoreLabeled(input(cases, records))
    expect(score.base.labels[0]?.brier).toBeCloseTo(0.5)
    expect(score.base.probabilistic).toBe(false)
    expect(score.candidate.labels[0]?.brier).toBeCloseTo(
      ((0.9 - 1) ** 2 + (0.2 - 0) ** 2) / 2,
    )
    expect(score.candidate.labels[1]?.brier).toBe(0)
    expect(score.candidate.probabilistic).toBe(true)
  })

  it('scores a choice label as a multi-class Brier and a score as none', () => {
    const labels: LabelDeclaration[] = [
      { name: 'stance', type: 'choice', options: ['yes', 'no', 'mixed'] },
      { name: 'rating', type: 'score' },
    ]
    const one: LabeledCase = {
      caseId: 'a',
      input: { text: 'fictional', channel: 'email' },
      expected: { stance: 'yes', rating: 3 },
    }
    const records = pairOf(
      one,
      { stance: { value: 'no' }, rating: { value: 3 } },
      {
        stance: {
          value: 'yes',
          probabilities: { yes: 0.6, no: 0.3, mixed: 0.1 },
        },
        rating: { value: 2 },
      },
    )
    const score = scoreLabeled(input([one], records, { labels }))
    expect(score.base.labels).toEqual([
      { name: 'stance', correct: 0, brier: 2 },
      { name: 'rating', correct: 1, brier: null },
    ])
    expect(score.candidate.labels[0]?.brier).toBeCloseTo(
      0.4 ** 2 + 0.3 ** 2 + 0.1 ** 2,
    )
    expect(score.candidate.labels[1]).toEqual({
      name: 'rating',
      correct: 0,
      brier: null,
    })
  })

  it("names the cases whose expected labels differ from the base ref's", () => {
    const cases = [
      labeledCase('same', true),
      labeledCase('relabeled', true),
      labeledCase('added', false),
    ]
    const records = cases.flatMap((one) => pairOf(one, hard(true), hard(true)))
    const score = scoreLabeled(
      input(cases, records, {
        baseExpected: new Map([
          ['same', { civicPanelJoin: false, optOut: true }],
          ['relabeled', { optOut: false, civicPanelJoin: false }],
        ]),
      }),
    )
    expect(score.expectedChanged).toEqual(['relabeled', 'added'])
  })

  it('says the base list was unread rather than guessing', () => {
    const one = labeledCase('a', true)
    const score = scoreLabeled(
      input([one], pairOf(one, hard(true), hard(true)), {
        baseExpected: null,
      }),
    )
    expect(score.expectedChanged).toBeNull()
  })
})
