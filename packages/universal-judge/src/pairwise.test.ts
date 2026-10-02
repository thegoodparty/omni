import { describe, expect, it } from 'vitest'
import { loadRubric, reconcile, type SingleJudgement } from './pairwise.js'
import type { Margin, VariantRole } from './types.js'

const judgement = (
  winner: VariantRole | 'tie',
  margin: Margin,
  rationale = 'because of the sourcing',
): SingleJudgement => ({
  winner,
  margin,
  decidingCriterion: 'source integrity',
  rationale,
  costUsd: 0.02,
})

describe('reconcile', () => {
  it('keeps a verdict both passes agreed on', () => {
    const v = reconcile(
      'c1',
      judgement('candidate', 'better'),
      judgement('candidate', 'better'),
    )
    expect(v.winner).toBe('candidate')
    expect(v.margin).toBe('better')
    expect(v.flipped).toBe(false)
  })

  it('takes the weaker margin when the passes disagree on strength', () => {
    const v = reconcile(
      'c1',
      judgement('candidate', 'much_better'),
      judgement('candidate', 'better'),
    )
    expect(v.margin).toBe('better')
  })

  it('takes the weaker margin regardless of which pass was stronger', () => {
    const v = reconcile(
      'c1',
      judgement('baseline', 'better'),
      judgement('baseline', 'much_better'),
    )
    expect(v.winner).toBe('baseline')
    expect(v.margin).toBe('better')
  })

  it('marks a direction reversal as unstable rather than picking a side', () => {
    const v = reconcile(
      'c1',
      judgement('candidate', 'much_better'),
      judgement('baseline', 'much_better'),
    )
    expect(v.flipped).toBe(true)
    expect(v.winner).toBe('tie')
    expect(v.margin).toBe('tie')
    expect(v.rationale).toMatch(/unstable under order swap/i)
  })

  it('treats a side-versus-tie disagreement as unstable too', () => {
    // The judge preferred the candidate one way round and called it even the
    // other. That is not a tie, it is an unreliable read.
    const v = reconcile(
      'c1',
      judgement('candidate', 'better'),
      judgement('tie', 'tie'),
    )
    expect(v.flipped).toBe(true)
  })

  it('agrees on a genuine tie without flagging instability', () => {
    const v = reconcile('c1', judgement('tie', 'tie'), judgement('tie', 'tie'))
    expect(v.flipped).toBe(false)
    expect(v.winner).toBe('tie')
  })

  it('sums the cost of both passes', () => {
    const v = reconcile('c1', judgement('tie', 'tie'), judgement('tie', 'tie'))
    expect(v.judgeCostUsd).toBeCloseTo(0.04, 10)
  })
})

describe('loadRubric', () => {
  it('returns the universal rubric for an agent with no addendum', () => {
    const rubric = loadRubric('no_such_agent')
    expect(rubric).toMatch(/Universal rubric/)
    expect(rubric).not.toMatch(/Agent-specific addendum/)
  })

  it('appends the addendum without dropping the universal rubric', () => {
    const rubric = loadRubric('find_existing_ordinances')
    expect(rubric).toMatch(/Universal rubric/)
    expect(rubric).toMatch(/Agent-specific addendum: find_existing_ordinances/)
    // The addendum adds to the tiers, it does not replace them.
    expect(rubric).toMatch(/Tier 1 — integrity/)
  })

  it('ships an addendum for every registered agent that has one on disk', () => {
    // Guards against an addendum being renamed out of alignment with the registry.
    for (const agent of [
      'meeting_briefing',
      'top_community_issues',
      'ordinance_draft',
    ]) {
      expect(loadRubric(agent)).toMatch(
        new RegExp(`Agent-specific addendum: ${agent}`),
      )
    }
  })
})
