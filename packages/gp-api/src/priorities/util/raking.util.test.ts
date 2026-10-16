import { describe, expect, it } from 'vitest'
import { poolSmallValues, rake, type RakingCell } from './raking.util'

const share = (
  cells: RakingCell[],
  weights: number[],
  dimension: string,
  value: string,
): number => {
  let hit = 0
  let known = 0
  cells.forEach((cell, index) => {
    const v = cell.values[dimension]
    if (v == null) return
    const mass = cell.count * (weights[index] ?? 0)
    known += mass
    if (v === value) hit += mass
  })
  return hit / known
}

describe('rake', () => {
  it('leaves a sample that already matches the census unweighted', () => {
    const cells: RakingCell[] = [
      { count: 50, values: { age: '18to64' } },
      { count: 50, values: { age: '65plus' } },
    ]
    const result = rake(cells, { age: { '18to64': 0.5, '65plus': 0.5 } })
    expect(result.weights[0]).toBeCloseTo(1)
    expect(result.weights[1]).toBeCloseTo(1)
    expect(result.effectiveSampleSize).toBeCloseTo(100)
    expect(result.largestGap).toBeCloseTo(0)
  })

  it('weights a skewed sample to the census and counts fewer effective answers', () => {
    const cells: RakingCell[] = [
      { count: 75, values: { age: '18to64' } },
      { count: 25, values: { age: '65plus' } },
    ]
    const result = rake(cells, { age: { '18to64': 0.5, '65plus': 0.5 } })
    expect(share(cells, result.weights, 'age', '65plus')).toBeCloseTo(0.5)
    expect(
      result.weights.reduce((s, w, i) => s + w * (cells[i]?.count ?? 0), 0),
    ).toBeCloseTo(100)
    // Kish: 100^2 / (75 * (2/3)^2 + 25 * 2^2) = 75
    expect(result.effectiveSampleSize).toBeCloseTo(75)
    expect(result.largestGap).toBeCloseTo(0)
  })

  it('matches two dimensions at once', () => {
    const cells: RakingCell[] = [
      { count: 40, values: { age: '18to64', tenure: 'owner' } },
      { count: 30, values: { age: '18to64', tenure: 'renter' } },
      { count: 25, values: { age: '65plus', tenure: 'owner' } },
      { count: 5, values: { age: '65plus', tenure: 'renter' } },
    ]
    const targets = {
      age: { '18to64': 0.8, '65plus': 0.2 },
      tenure: { owner: 0.5, renter: 0.5 },
    }
    const result = rake(cells, targets)
    expect(share(cells, result.weights, 'age', '65plus')).toBeCloseTo(0.2, 4)
    expect(share(cells, result.weights, 'tenure', 'renter')).toBeCloseTo(0.5, 4)
    expect(result.largestGap).toBeLessThan(1e-4)
  })

  it('caps weights, leaving a gap when a group is too thin to fix', () => {
    const cells: RakingCell[] = [
      { count: 98, values: { age: '18to64' } },
      { count: 2, values: { age: '65plus' } },
    ]
    const result = rake(cells, { age: { '18to64': 0.7, '65plus': 0.3 } })
    const [young = 1, old = 0] = result.weights
    expect(old / young).toBeLessThanOrEqual(25 + 1e-6)
    expect(share(cells, result.weights, 'age', '65plus')).toBeLessThan(0.3)
    expect(result.largestGap).toBeGreaterThan(0.05)
  })

  it('reports a census group no one answered from as the whole gap', () => {
    const cells: RakingCell[] = [{ count: 100, values: { age: '18to64' } }]
    const result = rake(cells, { age: { '18to64': 0.75, '65plus': 0.25 } })
    expect(result.weights[0]).toBeCloseTo(1)
    expect(result.largestGap).toBeCloseTo(0.25)
  })

  it('lets a respondent with an unknown value sit out that dimension only', () => {
    const cells: RakingCell[] = [
      { count: 30, values: { age: '18to64', tenure: null } },
      { count: 30, values: { age: '18to64', tenure: 'owner' } },
      { count: 40, values: { age: '65plus', tenure: 'renter' } },
    ]
    const result = rake(cells, {
      age: { '18to64': 0.8, '65plus': 0.2 },
      tenure: { owner: 0.5, renter: 0.5 },
    })
    expect(share(cells, result.weights, 'age', '65plus')).toBeCloseTo(0.2, 3)
    expect(share(cells, result.weights, 'tenure', 'owner')).toBeCloseTo(0.5, 3)
  })

  it('returns nothing for no respondents', () => {
    expect(rake([], { age: { '18to64': 1 } })).toEqual({
      weights: [],
      effectiveSampleSize: 0,
      gaps: [],
      largestGap: 0,
    })
  })
})

describe('poolSmallValues', () => {
  it('pools values with too few respondents in cells and targets', () => {
    const cells: RakingCell[] = [
      { count: 40, values: { area: 'a' } },
      { count: 3, values: { area: 'b' } },
      { count: 2, values: { area: 'c' } },
    ]
    const pooled = poolSmallValues(
      cells,
      { area: { a: 0.6, b: 0.25, c: 0.1, d: 0.05 } },
      'area',
      5,
      'other',
    )
    expect(pooled.cells.map((cell) => cell.values.area)).toEqual([
      'a',
      'other',
      'other',
    ])
    expect(pooled.targets.area?.a).toBeCloseTo(0.6)
    expect(pooled.targets.area?.other).toBeCloseTo(0.4)
  })

  it('changes nothing when every value is big enough', () => {
    const cells: RakingCell[] = [{ count: 10, values: { area: 'a' } }]
    const targets = { area: { a: 1 } }
    expect(poolSmallValues(cells, targets, 'area', 5, 'other')).toEqual({
      cells,
      targets,
    })
  })
})
