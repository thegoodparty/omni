import { describe, expect, it } from 'vitest'
import type { MrpGroupEstimate } from '@/priorities/util/mrp.util'
import {
  batchTargets,
  batchWeights,
  MAX_TARGET_WEIGHT,
  MIN_TARGET_WEIGHT,
  splitBatch,
} from './civicPanelAllocation.util'

const estimate = (
  dimension: string,
  value: string,
  share: number,
  answers: number,
  width: number,
): MrpGroupEstimate => ({
  dimension,
  value,
  share,
  answers,
  mean: 0.5,
  low: 0.5 - width / 2,
  high: 0.5 + width / 2,
})

const groups: MrpGroupEstimate[] = [
  estimate('age', '18to64', 0.8, 40, 0.1),
  estimate('age', '65plus', 0.2, 2, 0.5),
  estimate('tract', 't1', 0.5, 30, 0.1),
  estimate('tract', 't2', 0.3, 10, 0.4),
  estimate('tract', 't3', 0.18, 6, 0.2),
  estimate('tract', 't4', 0.02, 0, 0.9),
  estimate('race', 'Black', 0.4, 5, 0.35),
  estimate('race', 'other', 0.1, 1, 0.8),
  estimate('precinct', 'p1', 0.5, 0, 0.9),
]

describe('batchTargets', () => {
  it('puts groups short of three voices first, then the most doubt', () => {
    const targets = batchTargets(groups, ['age', 'tract', 'race'])
    expect(targets.map((t) => `${t.dimension}:${t.value}`)).toEqual([
      'age:65plus',
      'race:Black',
      'tract:t2',
      'age:18to64',
      'tract:t1',
      'tract:t3',
    ])
    expect(targets[0]?.reason).toBe('tooFewVoices')
    expect(targets[1]?.reason).toBe('leastSure')
  })

  it('never chases a minor group, the pooled other, or an unlisted one', () => {
    const keys = batchTargets(groups, ['age', 'tract']).map(
      (t) => `${t.dimension}:${t.value}`,
    )
    expect(keys).not.toContain('tract:t4')
    expect(keys).not.toContain('race:Black')
    expect(keys).not.toContain('precinct:p1')
  })
})

describe('batchWeights', () => {
  it('leans toward wide ranges within bounds', () => {
    const weights = batchWeights(groups, ['age', 'tract'])
    expect(weights.age['65plus']).toBe(MAX_TARGET_WEIGHT)
    expect(weights.tract.t2).toBeGreaterThan(1)
    expect(weights.tract.t1).toBeLessThan(1)
    expect(weights.tract.t1).toBeGreaterThanOrEqual(MIN_TARGET_WEIGHT)
    expect(weights.tract.t4).toBeUndefined()
    expect(weights.race).toEqual({})
    expect(weights.gender).toEqual({})
    expect(weights.maxWeight).toBe(MAX_TARGET_WEIGHT)
  })

  it('leaves the pooled race value unweighted', () => {
    const weights = batchWeights(groups, ['race'])
    expect(weights.race.Black).toBeDefined()
    expect(weights.race.other).toBeUndefined()
  })
})

describe('splitBatch', () => {
  it('keeps a slice of every batch unsteered', () => {
    expect(splitBatch(200)).toEqual({ steered: 170, unsteered: 30 })
    expect(splitBatch(0)).toEqual({ steered: 0, unsteered: 0 })
  })
})
