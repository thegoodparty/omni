import { describe, expect, it } from 'vitest'
import {
  binomialUpperTail,
  cannotJudge,
  choose,
  handledRegressionP,
  readVerdict,
  signTest,
} from './stats'

const noHandling = {
  basePass: 0,
  baseTotal: 0,
  candidatePass: 0,
  candidateTotal: 0,
  pWorse: 1,
}

describe('binomialUpperTail', () => {
  it('is 1 for an empty sample, because nothing is evidence', () => {
    expect(binomialUpperTail(0, 0)).toBe(1)
  })

  it('is the coin-flip probability of the observed count or more', () => {
    // Five of five: 1/32.
    expect(binomialUpperTail(5, 5)).toBeCloseTo(1 / 32, 10)
    // Three of five: (10 + 5 + 1) / 32.
    expect(binomialUpperTail(3, 5)).toBeCloseTo(16 / 32, 10)
    // A majority of four of six is not significant.
    expect(binomialUpperTail(4, 6)).toBeCloseTo(22 / 64, 10)
  })

  it('treats a count below zero as no evidence at all', () => {
    expect(binomialUpperTail(-1, 3)).toBe(1)
  })
})

describe('choose', () => {
  it('returns 0 outside the range', () => {
    expect(choose(3, 4)).toBe(0)
    expect(choose(3, -1)).toBe(0)
  })

  it('counts combinations', () => {
    expect(choose(5, 0)).toBe(1)
    expect(choose(5, 5)).toBe(1)
    expect(choose(5, 2)).toBe(10)
  })
})

describe('signTest', () => {
  it('reads a clean sweep as significant in one direction only', () => {
    const test = signTest(['candidate', 'candidate', 'candidate'])
    expect(test.forCandidate).toBe(3)
    expect(test.forBase).toBe(0)
    expect(test.pBetter).toBeCloseTo(1 / 8, 10)
    expect(test.pWorse).toBe(1)
  })

  it('does not count ties as votes', () => {
    const test = signTest(['candidate', 'tie', 'tie'])
    expect(test.forCandidate).toBe(1)
    expect(test.forBase).toBe(0)
    expect(test.ties).toBe(2)
    expect(test.pBetter).toBeCloseTo(0.5, 10)
  })

  it('is no evidence when every pair tied', () => {
    const test = signTest(['tie', 'tie', 'tie'])
    expect(test.forCandidate + test.forBase).toBe(0)
    expect(test.pBetter).toBe(1)
    expect(test.pWorse).toBe(1)
  })
})

describe('handledRegressionP', () => {
  it('is 1 when the candidate passed as often as the base', () => {
    expect(handledRegressionP(3, 0, 3, 0)).toBe(1)
  })

  it('is 1 when the candidate passed more often', () => {
    expect(handledRegressionP(3, 0, 1, 2)).toBe(1)
  })

  it('is small when the candidate passed much less often', () => {
    // candidate 0/3, base 3/3: the only table at least this extreme is the one
    // observed, and its hypergeometric probability is 1/20.
    expect(handledRegressionP(0, 3, 3, 0)).toBeCloseTo(0.05, 10)
  })

  it('reaches significance once the suite has more than one case', () => {
    // Six pairs per side, all passing on base and none on candidate.
    expect(handledRegressionP(0, 6, 6, 0)).toBeLessThan(0.05)
  })

  it('is no evidence when nothing was graded', () => {
    expect(handledRegressionP(0, 0, 0, 0)).toBe(1)
  })

  it('counts the tail below the observed count, not above it', () => {
    // candidate 1/3 vs base 3/3 is less extreme than 0/3.
    expect(handledRegressionP(1, 2, 3, 0)).toBeGreaterThan(
      handledRegressionP(0, 3, 3, 0),
    )
  })
})

describe('cannotJudge', () => {
  it('is true when nothing was judged', () => {
    expect(cannotJudge(0, 0)).toBe(true)
    expect(cannotJudge(0, 3)).toBe(true)
  })

  it('is true when more than half the pairs were not judged', () => {
    expect(cannotJudge(2, 3)).toBe(true)
  })

  it('is false at exactly half', () => {
    expect(cannotJudge(3, 3)).toBe(false)
  })

  it('is false when most pairs were judged', () => {
    expect(cannotJudge(9, 1)).toBe(false)
  })
})

describe('readVerdict', () => {
  it('cannot reach significance from one case alone', () => {
    // Three of three is p = 0.125: an exact test over one case's three attempts
    // can never call a verdict, whatever the pairs say. That is the point of an
    // exact test on so little data, not a bug.
    const verdict = readVerdict({
      votes: ['candidate', 'candidate', 'candidate'],
      handled: noHandling,
    })
    expect(verdict.sign.pBetter).toBeCloseTo(0.125, 10)
    expect(verdict.label).toBe('NO DIFFERENCE FOUND')
  })

  it('is BETTER when the candidate won enough pairs', () => {
    const verdict = readVerdict({
      votes: ['candidate', 'candidate', 'candidate', 'candidate', 'candidate'],
      handled: noHandling,
    })
    expect(verdict.label).toBe('BETTER')
  })

  it('is WORSE when the base won enough pairs', () => {
    const verdict = readVerdict({
      votes: ['base', 'base', 'base', 'base', 'base'],
      handled: noHandling,
    })
    expect(verdict.label).toBe('WORSE')
  })

  it('is NO DIFFERENCE FOUND when both directions are plausible', () => {
    const verdict = readVerdict({
      votes: ['base', 'candidate', 'tie'],
      handled: noHandling,
    })
    expect(verdict.label).toBe('NO DIFFERENCE FOUND')
  })

  it('is WORSE when the handling pass rate dropped, even with tied pairs', () => {
    const verdict = readVerdict({
      votes: ['tie', 'tie', 'tie', 'tie', 'tie', 'tie'],
      handled: {
        basePass: 6,
        baseTotal: 6,
        candidatePass: 0,
        candidateTotal: 6,
        pWorse: handledRegressionP(0, 6, 6, 0),
      },
    })
    expect(verdict.label).toBe('WORSE')
  })

  it('prefers WORSE over BETTER when the directions conflict', () => {
    // A shared failure reading as a tie is exactly this shape: the outputs look
    // better while the case's own pass rule got worse.
    const verdict = readVerdict({
      votes: ['candidate', 'candidate', 'candidate', 'candidate', 'candidate'],
      handled: {
        basePass: 6,
        baseTotal: 6,
        candidatePass: 0,
        candidateTotal: 6,
        pWorse: handledRegressionP(0, 6, 6, 0),
      },
    })
    expect(verdict.sign.pBetter).toBeLessThan(0.05)
    expect(verdict.label).toBe('WORSE')
  })

  it("is CAN'T JUDGE when no pair reached the grader", () => {
    const verdict = readVerdict({
      votes: [],
      handled: noHandling,
      notJudged: 3,
    })
    expect(verdict.label).toBe("CAN'T JUDGE")
    expect(verdict.notJudged).toBe(3)
  })

  it("is CAN'T JUDGE when more than half the pairs did not", () => {
    const verdict = readVerdict({
      votes: ['candidate', 'candidate'],
      handled: noHandling,
      notJudged: 4,
    })
    expect(verdict.label).toBe("CAN'T JUDGE")
  })

  it('still reads a verdict when exactly half the pairs did not', () => {
    // Five of ten is a majority and four of eight is not; the line is "more than
    // half", so an even split is judged on the half that ran.
    const verdict = readVerdict({
      votes: ['candidate', 'candidate', 'candidate', 'candidate', 'candidate'],
      handled: noHandling,
      notJudged: 5,
    })
    expect(verdict.label).toBe('BETTER')
  })

  it("is CAN'T JUDGE rather than WORSE on the little that ran", () => {
    const verdict = readVerdict({
      votes: ['base'],
      handled: noHandling,
      notJudged: 2,
    })
    expect(verdict.label).toBe("CAN'T JUDGE")
  })

  it('does not call a minority of pairs significant', () => {
    const verdict = readVerdict({
      votes: [
        'candidate',
        'candidate',
        'candidate',
        'candidate',
        'base',
        'base',
      ],
      handled: noHandling,
    })
    expect(verdict.sign.pBetter).toBeGreaterThan(0.05)
    expect(verdict.label).toBe('NO DIFFERENCE FOUND')
  })
})
