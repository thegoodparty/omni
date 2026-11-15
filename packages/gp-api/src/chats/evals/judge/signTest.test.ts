import { describe, expect, it } from 'vitest'
import { signTest } from './signTest'

describe('signTest', () => {
  it('reads 5 of 5 one way as 1/32 and the other tail as certain', () => {
    expect(signTest([-1, -1, -1, -1, -1])).toEqual({
      forCandidate: 0,
      forBase: 5,
      pBetter: 1,
      pWorse: 1 / 32,
    })
  })

  it('reads 3 of 3 as 1/8', () => {
    expect(signTest([1, 1, 1]).pBetter).toBe(1 / 8)
  })

  it('reads 4 of 5 as 6/32', () => {
    const test = signTest([1, 1, 1, 1, -1])
    expect(test.pBetter).toBe(6 / 32)
    expect(test.pWorse).toBe(31 / 32)
  })

  // A tie is not a vote, so the denominator is the deciding cases only.
  it('drops ties from the count', () => {
    expect(signTest([0, 0, -1, -1, 0])).toEqual({
      forCandidate: 0,
      forBase: 2,
      pBetter: 1,
      pWorse: 1 / 4,
    })
  })

  // A fractional case mean (three attempts, two for the base) is still one
  // vote, by its sign.
  it('votes by sign, not by size', () => {
    expect(signTest([-1 / 3, 1 / 3, -1])).toEqual({
      forCandidate: 1,
      forBase: 2,
      pBetter: 7 / 8,
      pWorse: 1 / 2,
    })
  })

  it('reads nothing as certain both ways', () => {
    expect(signTest([])).toEqual({
      forCandidate: 0,
      forBase: 0,
      pBetter: 1,
      pWorse: 1,
    })
  })

  it('caps a tail at one', () => {
    const test = signTest([1, -1])
    expect(test.pBetter).toBe(3 / 4)
    expect(test.pWorse).toBe(3 / 4)
  })
})
