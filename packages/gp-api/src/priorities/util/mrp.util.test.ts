import { describe, expect, it } from 'vitest'
import {
  estimateMrp,
  fitMrp,
  learnMrpScales,
  type MrpAnswerCell,
  type MrpFrameCell,
  type MrpGroupEstimate,
} from './mrp.util'

const AGES = ['18to34', '35to64', '65plus']
const TRACTS = ['t1', 't2', 't3', 't4']

const frame: MrpFrameCell[] = AGES.flatMap((age) =>
  TRACTS.map((tract) => ({ count: 500, values: { age, tract } })),
)

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x))

const AGE_EFFECT: Record<string, number> = {
  '18to34': -1,
  '35to64': 0,
  '65plus': 1,
}

const truthOf = (values: Record<string, string>): number =>
  sigmoid(AGE_EFFECT[values.age ?? ''] ?? 0)

const groupTruth = (dimension: string, value: string): number => {
  const cells = frame.filter((c) => c.values[dimension] === value)
  const total = cells.reduce((sum, c) => sum + c.count, 0)
  return cells.reduce((sum, c) => sum + c.count * truthOf(c.values), 0) / total
}

const seeded = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const simulate = (perCell: number, seed: number): MrpAnswerCell[] => {
  const next = seeded(seed)
  return frame.map((cell) => {
    let yes = 0
    for (let i = 0; i < perCell; i++) {
      if (next() < truthOf(cell.values)) yes += 1
    }
    return { yes, answers: perCell, values: cell.values }
  })
}

const group = (
  groups: MrpGroupEstimate[],
  dimension: string,
  value: string,
): MrpGroupEstimate => {
  const found = groups.find(
    (g) => g.dimension === dimension && g.value === value,
  )
  if (!found) throw new Error(`no group ${dimension}:${value}`)
  return found
}

describe('estimateMrp', () => {
  it('recovers group opinion from plenty of answers', () => {
    const answers = frame.map((cell) => ({
      yes: Math.round(200 * truthOf(cell.values)),
      answers: 200,
      values: cell.values,
    }))
    const result = estimateMrp(answers, frame, { age: 1, tract: 0.5 })
    for (const age of AGES) {
      const estimate = group(result.groups, 'age', age)
      expect(estimate.mean).toBeCloseTo(groupTruth('age', age), 1)
      expect(estimate.low).toBeLessThan(groupTruth('age', age))
      expect(estimate.high).toBeGreaterThan(groupTruth('age', age))
      expect(estimate.answers).toBe(800)
      expect(estimate.share).toBeCloseTo(1 / 3)
    }
  })

  it('pulls a group with two answers toward the district', () => {
    const answers: MrpAnswerCell[] = [
      ...frame
        .filter((c) => c.values.tract !== 't4')
        .map((c) => ({ yes: 15, answers: 30, values: c.values })),
      { yes: 2, answers: 2, values: { age: '35to64', tract: 't4' } },
    ]
    const result = estimateMrp(answers, frame, { age: 0.5, tract: 0.5 })
    const t4 = group(result.groups, 'tract', 't4')
    expect(t4.answers).toBe(2)
    expect(t4.mean).toBeLessThan(0.75)
    expect(t4.mean).toBeGreaterThan(result.district.mean)
    expect(t4.high - t4.low).toBeGreaterThan(
      group(result.groups, 'tract', 't1').high -
        group(result.groups, 'tract', 't1').low,
    )
  })

  it('knows nothing without answers', () => {
    const result = estimateMrp([], frame, { age: 0.5, tract: 0.5 })
    expect(result.district.mean).toBeCloseTo(0.5, 1)
    expect(result.district.high - result.district.low).toBeGreaterThan(0.5)
  })

  it('lets an unknown or unframed value sit out its dimension', () => {
    const fit = fitMrp(
      [
        { yes: 3, answers: 4, values: { age: null, tract: 't1' } },
        { yes: 1, answers: 4, values: { age: 'under18', tract: 't2' } },
      ],
      frame,
      { age: 0.5, tract: 0.5 },
    )
    expect(fit.coefficients.every(Number.isFinite)).toBe(true)
  })

  it('gives the same ranges for the same seed', () => {
    const answers = simulate(5, 7)
    const scales = { age: 0.5, tract: 0.5 }
    expect(estimateMrp(answers, frame, scales, { seed: 3 })).toEqual(
      estimateMrp(answers, frame, scales, { seed: 3 }),
    )
  })

  it('holds the truth in about nine of ten ranges', () => {
    let held = 0
    let total = 0
    for (let rep = 0; rep < 40; rep++) {
      const result = estimateMrp(
        simulate(4, 100 + rep),
        frame,
        { age: 1, tract: 0.3 },
        { seed: rep + 1, draws: 300 },
      )
      for (const g of result.groups) {
        const truth = groupTruth(g.dimension, g.value)
        if (g.low <= truth && truth <= g.high) held += 1
        total += 1
      }
    }
    expect(held / total).toBeGreaterThan(0.8)
    expect(held / total).toBeLessThan(0.99)
  })
})

describe('learnMrpScales', () => {
  it('keeps the start scale with no past questions', () => {
    expect(learnMrpScales([], frame)).toEqual({ age: 0.5, tract: 0.5 })
  })

  it('learns which dimension splits opinion', () => {
    const past = [1, 2, 3, 4, 5].map((seed) => simulate(15, seed))
    const scales = learnMrpScales(past, frame)
    expect(scales.age).toBeGreaterThan(0.6)
    expect(scales.tract).toBeLessThan(0.3)
  })
})
