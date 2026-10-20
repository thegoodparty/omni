import { describe, expect, it } from 'vitest'
import { MAX_LIST_SAMPLE_SIZE } from '@goodparty_org/contracts'
import type { DistrictCell } from '@/peopleDb/databricks/districtCensusSql.util'
import type { MrpGroupEstimate } from '@/priorities/util/mrp.util'
import {
  batchTargets,
  batchWeights,
  CALL_ANSWER_RATE,
  DOOR_ANSWER_RATE,
  MAX_TARGET_WEIGHT,
  MIN_TARGET_WEIGHT,
  sizeRoundOne,
  splitBatch,
  TEXT_ANSWER_RATE,
} from './civicPanelAllocation.util'
import { sizePanelWave } from './civicPanelBuild.util'

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

describe('sizeRoundOne', () => {
  const cell = (
    ageBand: DistrictCell['ageBand'],
    tract: string | null,
    race: DistrictCell['race'],
    count: number,
  ): DistrictCell => ({ ageBand, gender: null, tract, race, count })

  const district: DistrictCell[] = [
    cell('18to64', 't1', 'white', 6_000),
    cell('65plus', 't2', 'black', 3_000),
    cell('18to64', 't3', null, 1_000),
  ]
  const shares = {
    age: { '18to64': 0.7, '65plus': 0.3 },
    tract: { t1: 0.6, t2: 0.28, t3: 0.1, t4: 0.02 },
    race: { white: 0.6, black: 0.3, other: 0.1 },
  }
  const ALL = ['age', 'gender', 'tract', 'race'] as const
  const size = (overrides: Partial<Parameters<typeof sizeRoundOne>[0]> = {}) =>
    sizeRoundOne({
      hoursPerWeek: 1,
      districtShares: shares,
      dimensions: ALL,
      pools: { door: district, phone: district, text: district },
      ...overrides,
    })
  const answersOf = (result: ReturnType<typeof sizeRoundOne>) =>
    Object.fromEntries(
      result.groups.map((g) => [
        `${g.dimension}:${g.value}`,
        g.expectedAnswers,
      ]),
    )

  it('keeps the assumed answer rates at their placeholder values', () => {
    expect(DOOR_ANSWER_RATE).toBe(0.1)
    expect(CALL_ANSWER_RATE).toBe(0.05)
    expect(TEXT_ANSWER_RATE).toBe(0.03)
  })

  it('splits the hours into doors and calls the way the panel plan does', () => {
    const result = size()
    const wave = sizePanelWave({
      gap: Number.POSITIVE_INFINITY,
      hoursPerWeek: 1,
      pools: { text: 0, phone: 10_000, door: 10_000 },
    })
    expect(result.doors).toBe(40)
    expect(result.calls).toBe(30)
    expect(result.doors).toBe(
      wave
        .filter((s) => s.channel === 'door_knocking')
        .reduce((sum, s) => sum + s.targetSize, 0),
    )
  })

  it('sizes the text for the group the hours leave furthest short', () => {
    const result = size()
    // t3: 40 doors x 10% x 10% + 30 calls x 10% x 5% = 0.55 answers, and
    // each text reaches it at 10% x 3%: ceil(2.45 / 0.003).
    expect(result.texts).toBe(817)
    const answers = answersOf(result)
    expect(answers['tract:t3']).toBe(3)
    for (const group of result.groups) {
      expect(group.expectedAnswers).toBeGreaterThanOrEqual(3)
    }
  })

  it('names only major groups, never other, and race only when asked to', () => {
    const keys = Object.keys(answersOf(size()))
    expect(keys.sort()).toEqual([
      'age:18to64',
      'age:65plus',
      'race:black',
      'race:white',
      'tract:t1',
      'tract:t2',
      'tract:t3',
    ])
    const noRace = Object.keys(
      answersOf(size({ dimensions: ['age', 'gender', 'tract'] })),
    )
    expect(noRace.some((key) => key.startsWith('race:'))).toBe(false)
  })

  it('never texts more people than it can reach', () => {
    const result = size({
      pools: {
        door: district,
        phone: district,
        text: [
          cell('18to64', 't1', 'white', 300),
          cell('65plus', 't2', 'black', 150),
          cell('18to64', 't3', null, 50),
        ],
      },
    })
    expect(result.texts).toBe(500)
  })

  it('leaves a group no cell phone reaches out of the text size', () => {
    const result = size({
      pools: {
        door: district,
        phone: district,
        text: district.filter((c) => c.tract !== 't3'),
      },
    })
    // The next furthest short: 1.65 answers from the hours, and 1 in 3 of
    // 9,000 cell phones at 3%.
    expect(result.texts).toBe(135)
    expect(answersOf(result)['tract:t3']).toBe(0.6)
  })

  it('sends no text when the hours already reach every group', () => {
    const even = [
      cell('18to64', 't1', null, 5_000),
      cell('65plus', 't1', null, 5_000),
    ]
    const result = size({
      hoursPerWeek: 20,
      districtShares: { age: { '18to64': 0.5, '65plus': 0.5 } },
      pools: { door: even, phone: even, text: even },
    })
    expect(result.doors).toBe(200)
    expect(result.texts).toBe(0)
  })

  it('stays under the sampler ceiling', () => {
    const wide = [
      cell('18to64', 't1', null, 99_500),
      cell('18to64', 't3', null, 500),
    ]
    const result = size({
      districtShares: { tract: { t1: 0.95, t3: 0.05 } },
      pools: { door: wide, phone: wide, text: wide },
    })
    expect(result.texts).toBe(MAX_LIST_SAMPLE_SIZE)
  })

  it('reaches nobody when no channel can', () => {
    expect(size({ pools: { door: [], phone: [], text: [] } })).toMatchObject({
      doors: 0,
      calls: 0,
      texts: 0,
    })
  })
})
