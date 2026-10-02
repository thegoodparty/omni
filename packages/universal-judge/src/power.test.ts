import { describe, expect, it } from 'vitest'
import { MIN_POWERED_CASES, signTest, summarise } from './aggregate.js'
import type { AgentResult, CaseVerdict, Margin } from './types.js'

/**
 * Regression tests for the power floor.
 *
 * The first real A/A run — same tree on both sides, two cases — came back
 * "candidate is much worse, 0/0/2" while the sign test reported p=0.5. Run-to-run
 * variance alone produced a confident-looking sweep. These pin the fix: no
 * direction is claimed until the sample could in principle support one.
 */

const verdict = (
  id: string,
  winner: CaseVerdict['winner'],
  margin: Margin,
): CaseVerdict => ({
  caseId: id,
  winner,
  margin,
  decidingCriterion: 'specificity',
  rationale: 'r',
  flipped: false,
  judgeCostUsd: 0,
})

const sweep = (
  n: number,
  winner: CaseVerdict['winner'],
  margin: Margin = 'better',
) =>
  summarise({
    agent: 'a',
    verdicts: Array.from({ length: n }, (_, i) =>
      verdict(`c${i}`, winner, margin),
    ),
    runs: [],
    notes: [],
  } satisfies AgentResult)

describe('power floor', () => {
  it('reproduces the A/A case: two losses do not make the candidate worse', () => {
    const s = sweep(2, 'baseline', 'much_better')
    expect(s.verdict).toBe('not enough cases to call')
    expect(s.explanation).toMatch(/cannot reach p<0\.05/)
  })

  it('still reports the tally so the reader can see what happened', () => {
    const s = sweep(2, 'baseline', 'much_better')
    expect(s.wins).toBe(0)
    expect(s.losses).toBe(2)
    expect(s.meanScore).toBe(-2)
    expect(s.explanation).toMatch(/0 win \/ 0 tie \/ 2 loss/)
  })

  it('holds the line just below the floor', () => {
    expect(sweep(MIN_POWERED_CASES - 1, 'candidate').verdict).toBe(
      'not enough cases to call',
    )
  })

  it('calls a direction once the sample can support one', () => {
    const s = sweep(MIN_POWERED_CASES, 'candidate')
    expect(s.verdict).toBe('candidate is much better')
    expect(s.signTestP!).toBeLessThan(0.05)
  })

  it('agrees with the arithmetic it is derived from', () => {
    // The floor exists because 2/2^n only crosses 0.05 at n=6.
    expect(signTest(MIN_POWERED_CASES - 1, 0)!).toBeGreaterThan(0.05)
    expect(signTest(MIN_POWERED_CASES, 0)!).toBeLessThan(0.05)
  })

  it('counts only cases that separated the sides, not ties', () => {
    // Ten cases, but eight were ties: still underpowered.
    const verdicts = [
      ...Array.from({ length: 2 }, (_, i) =>
        verdict(`w${i}`, 'candidate', 'much_better'),
      ),
      ...Array.from({ length: 8 }, (_, i) => verdict(`t${i}`, 'tie', 'tie')),
    ]
    const s = summarise({ agent: 'a', verdicts, runs: [], notes: [] })
    expect(s.verdict).not.toMatch(/candidate is/)
  })

  it('lets an unstable judge win the argument over a lopsided tally', () => {
    // Flip rate is checked first: an unreliable judge is reported as such even if
    // the surviving cases happen to look decisive.
    const verdicts = [
      ...Array.from({ length: 6 }, (_, i) =>
        verdict(`f${i}`, 'tie', 'tie'),
      ).map((v) => ({
        ...v,
        flipped: true,
      })),
      ...Array.from({ length: 6 }, (_, i) =>
        verdict(`c${i}`, 'candidate', 'much_better'),
      ),
    ]
    const s = summarise({ agent: 'a', verdicts, runs: [], notes: [] })
    expect(s.verdict).toBe('inconclusive')
  })
})
