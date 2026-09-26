import { describe, expect, it } from 'vitest'
import { MAX_FLIP_RATE, signTest, summarise } from './aggregate.js'
import type { AgentResult, CaseVerdict, Margin, RunOutcome } from './types.js'

const verdict = (
  caseId: string,
  winner: CaseVerdict['winner'],
  margin: Margin,
  flipped = false,
): CaseVerdict => ({
  caseId,
  winner,
  margin,
  decidingCriterion: 'specific over generic',
  rationale: 'because',
  flipped,
  judgeCostUsd: 0.01,
})

const result = (
  verdicts: CaseVerdict[],
  runs: RunOutcome[] = [],
): AgentResult => ({
  agent: 'test_agent',
  verdicts,
  runs,
  notes: [],
})

describe('signTest', () => {
  it('is undefined when every verdict was a tie', () => {
    expect(signTest(0, 0)).toBeUndefined()
  })

  it('cannot distinguish an even split from a coin', () => {
    expect(signTest(5, 5)).toBe(1)
  })

  it('calls a clean sweep significant', () => {
    const p = signTest(10, 0)
    expect(p).toBeLessThan(0.01)
    // Two-sided exact binomial: 2 * (1/2^10).
    expect(p).toBeCloseTo(2 / 1024, 10)
  })

  it('is symmetric in direction', () => {
    expect(signTest(8, 2)).toBe(signTest(2, 8))
  })
})

describe('summarise', () => {
  it('reports a clean candidate sweep as better with a significant p-value', () => {
    const s = summarise(
      result(
        Array.from({ length: 6 }, (_, i) =>
          verdict(`c${i}`, 'candidate', 'better'),
        ),
      ),
    )
    expect(s.wins).toBe(6)
    expect(s.losses).toBe(0)
    expect(s.meanScore).toBe(1)
    expect(s.verdict).toBe('candidate is much better')
    expect(s.signTestP!).toBeLessThan(0.05)
  })

  it('signs the score negatively when the baseline wins', () => {
    const s = summarise(
      result(
        Array.from({ length: 6 }, (_, i) =>
          verdict(`c${i}`, 'baseline', 'much_better'),
        ),
      ),
    )
    expect(s.meanScore).toBe(-2)
    expect(s.verdict).toBe('candidate is much worse')
  })

  it('calls a small mean no material change even when the sign test likes it', () => {
    // Six wins by the narrowest margin is a clean sweep by count, but mixing in
    // ties drags the mean below the decisiveness floor.
    const verdicts = [
      ...Array.from({ length: 2 }, (_, i) =>
        verdict(`w${i}`, 'candidate', 'better'),
      ),
      ...Array.from({ length: 8 }, (_, i) => verdict(`t${i}`, 'tie', 'tie')),
    ]
    const s = summarise(result(verdicts))
    expect(s.meanScore).toBeCloseTo(0.2, 10)
    expect(s.verdict).toBe('no material change')
  })

  it('reports inconclusive when too many pairs flipped under order swap', () => {
    const verdicts = [
      ...Array.from({ length: 3 }, (_, i) =>
        verdict(`f${i}`, 'tie', 'tie', true),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        verdict(`c${i}`, 'candidate', 'much_better'),
      ),
    ]
    const s = summarise(result(verdicts))
    expect(s.flipRate).toBeGreaterThan(MAX_FLIP_RATE)
    expect(s.verdict).toBe('inconclusive')
  })

  it('excludes flipped pairs from the score rather than counting them as ties', () => {
    // One flip in ten is under the bar, so a verdict is still reported, but the
    // flipped pair must not dilute the mean.
    const verdicts = [
      verdict('f0', 'tie', 'tie', true),
      ...Array.from({ length: 9 }, (_, i) =>
        verdict(`c${i}`, 'candidate', 'better'),
      ),
    ]
    const s = summarise(result(verdicts))
    expect(s.cases).toBe(10)
    expect(s.meanScore).toBe(1)
    expect(s.verdict).toBe('candidate is much better')
  })

  it('averages cost and duration only over runs that succeeded', () => {
    const runs: RunOutcome[] = [
      {
        caseId: 'a',
        variant: 'baseline',
        status: 'ok',
        costUsd: 2,
        durationSeconds: 100,
      },
      {
        caseId: 'b',
        variant: 'baseline',
        status: 'ok',
        costUsd: 4,
        durationSeconds: 200,
      },
      {
        caseId: 'c',
        variant: 'baseline',
        status: 'timeout',
        costUsd: 99,
        durationSeconds: 99,
      },
      {
        caseId: 'a',
        variant: 'candidate',
        status: 'ok',
        costUsd: 1,
        durationSeconds: 50,
      },
      {
        caseId: 'b',
        variant: 'candidate',
        status: 'ok',
        costUsd: 3,
        durationSeconds: 150,
      },
    ]
    const s = summarise(result([verdict('a', 'candidate', 'better')], runs))
    expect(s.baselineCostUsd).toBe(3)
    expect(s.candidateCostUsd).toBe(2)
    expect(s.baselineDurationSeconds).toBe(150)
    expect(s.failures).toHaveLength(1)
  })

  it('leaves cost undefined when no run reported one', () => {
    const runs: RunOutcome[] = [
      { caseId: 'a', variant: 'baseline', status: 'ok' },
    ]
    const s = summarise(result([verdict('a', 'tie', 'tie')], runs))
    expect(s.baselineCostUsd).toBeUndefined()
  })

  it('handles an empty run', () => {
    const s = summarise(result([]))
    expect(s.verdict).toBe('no result')
    expect(s.meanScore).toBe(0)
  })
})
