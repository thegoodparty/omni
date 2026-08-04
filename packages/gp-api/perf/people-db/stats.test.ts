import { describe, it, expect } from 'vitest'
import { summarize, errorRate } from './stats'

describe('summarize', () => {
  it('computes nearest-rank percentiles and basic stats', () => {
    const s = summarize([10, 20, 30, 40, 100])
    expect(s).toEqual({
      count: 5,
      min: 10,
      max: 100,
      mean: 40,
      p50: 30,
      p95: 100,
    })
  })

  it('returns zeros for empty input', () => {
    expect(summarize([])).toEqual({
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      p50: 0,
      p95: 0,
    })
  })
})

describe('errorRate', () => {
  it('is failures over total', () => {
    expect(errorRate(10, 2)).toBe(0.2)
  })
  it('is 0 when total is 0', () => {
    expect(errorRate(0, 0)).toBe(0)
  })
})
