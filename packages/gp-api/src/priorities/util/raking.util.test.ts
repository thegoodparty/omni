import { describe, expect, it } from 'vitest'
import { poolSmallValues, type RakingCell } from './raking.util'

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

  it('keeps a lone small value under its own name', () => {
    const cells: RakingCell[] = [{ count: 10, values: { tenure: 'owner' } }]
    const targets = { tenure: { owner: 0.4, renter: 0.6 } }
    expect(poolSmallValues(cells, targets, 'tenure', 5, 'other')).toEqual({
      cells,
      targets,
    })
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
