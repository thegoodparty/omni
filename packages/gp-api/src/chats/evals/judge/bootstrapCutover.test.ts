import { describe, expect, it } from 'vitest'
import { bootstrapCi, createRng } from './bootstrap'
import { DEFAULT_JUDGE_CONFIG } from './config'
import { signTest } from './signTest'

// WHY THE CUTOVER IS WHERE IT IS. On one-attempt data every case score is a
// sign, so the resampled interval and the exact count are two readings of
// the same split, and the question is which one over-calls. Under the
// cutover the interval does, on every seed: 3 of 3 (p = 1/8), 4 of 4 and
// 6 of 7 (p = 1/16) all read as a verdict. From the cutover up the only
// splits it calls that the count refuses sit within a hundredth of alpha
// (8 of 10 at p = 0.055, 11 of 15 at 0.059), and only on some seeds. So
// switching to the interval there costs at most a coin-flip on a split the
// count itself nearly calls, and the interval brings the margin and SAME.

const { bootstrapMinCases, sign } = DEFAULT_JUDGE_CONFIG.gates
const SEEDS = [1, 2, 3, 7, 42]
const NEAR_ALPHA = sign.alpha + 0.01

const intervalCalls = (scores: number[], seed: number): boolean => {
  const interval = bootstrapCi(
    scores,
    DEFAULT_JUDGE_CONFIG.bootstrap,
    createRng(seed),
  )
  return interval !== null && (interval.upper < 0 || interval.lower > 0)
}

const splits = (cases: number): number[][] =>
  Array.from({ length: cases + 1 }, (_, forBase) => [
    ...Array.from({ length: forBase }, () => -1),
    ...Array.from({ length: cases - forBase }, () => 1),
  ])

describe('the bootstrap cutover', () => {
  it('is 8 cases', () => {
    expect(bootstrapMinCases).toBe(8)
  })

  // Every split from the cutover to twenty cases, under five seeds: a split
  // the interval calls is one the count calls, or one within a hundredth of
  // alpha.
  it.each(
    Array.from({ length: 20 - bootstrapMinCases + 1 }, (_, i) => [
      bootstrapMinCases + i,
    ]),
  )('from %i cases the interval calls nothing the count is far from', (n) => {
    for (const scores of splits(n)) {
      for (const seed of SEEDS) {
        if (!intervalCalls(scores, seed)) continue
        const test = signTest(scores)
        expect(
          Math.min(test.pWorse, test.pBetter),
          `${scores.join(' ')} seed ${seed}`,
        ).toBeLessThan(NEAR_ALPHA)
      }
    }
  })

  // One under the cutover the interval calls, on every seed, a split the
  // count is well clear of: 6 of 7 one way is p = 1/16. The cutover is the
  // lowest number from which the test above holds.
  it('one case under it the interval over-calls on every seed', () => {
    const scores = [-1, -1, -1, -1, -1, -1, 1]
    expect(signTest(scores).pWorse).toBeCloseTo(8 / 128, 10)
    expect(signTest(scores).pWorse).toBeGreaterThan(NEAR_ALPHA)
    expect(SEEDS.every((seed) => intervalCalls(scores, seed))).toBe(true)
  })

  // The case the whole change exists for: three unanimous cases are a point
  // interval that excludes zero, and a 1-in-8 coincidence.
  it('three of three is a point interval and a p of 1/8', () => {
    const scores = [-1, -1, -1]
    expect(
      bootstrapCi(scores, DEFAULT_JUDGE_CONFIG.bootstrap, createRng(1)),
    ).toEqual({ lower: -1, upper: -1 })
    expect(signTest(scores).pWorse).toBe(1 / 8)
  })
})
