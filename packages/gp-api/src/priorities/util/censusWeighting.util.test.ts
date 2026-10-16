import { describe, expect, it } from 'vitest'
import {
  ACS_COUNT_KEYS,
  type AcsCountKey,
  type AcsCounts,
  type RespondentCell,
} from '@/peopleDb/databricks/districtCensusSql.util'
import { weighToCensus, weightingTargets } from './censusWeighting.util'

const acs = (overrides: Partial<Record<AcsCountKey, number>>): AcsCounts =>
  Object.fromEntries(
    ACS_COUNT_KEYS.map((key) => [key, overrides[key] ?? 0]),
  ) as AcsCounts

const DISTRICT = acs({
  totalPopulation: 1_250,
  populationUnder18: 250,
  population65Plus: 200,
  households: 400,
  ownerOccupiedHouseholds: 240,
})

const TRACTS = new Map([
  ['53017950100', 600],
  ['53017950200', 400],
])

const cell = (
  overrides: Partial<RespondentCell> & { count: number },
): RespondentCell => ({
  ageBand: '18to64',
  gender: null,
  tenure: 'owner',
  tract: '53017950100',
  ...overrides,
})

describe('weightingTargets', () => {
  it('reads adult age bands, household tenure and tract adults', () => {
    const targets = weightingTargets({
      district: DISTRICT,
      tractAdults: TRACTS,
    })
    expect(targets.age?.['65plus']).toBeCloseTo(0.2)
    expect(targets.age?.['18to64']).toBeCloseTo(0.8)
    expect(targets.tenure?.owner).toBeCloseTo(0.6)
    expect(targets.tract?.['53017950200']).toBeCloseTo(0.4)
    expect(targets.gender).toBeUndefined()
  })

  it('leaves out a dimension the census suppressed', () => {
    const targets = weightingTargets({
      district: { ...DISTRICT, ownerOccupiedHouseholds: null },
      tractAdults: new Map(),
    })
    expect(Object.keys(targets)).toEqual(['age'])
  })

  it('takes gender once the marts publish it', () => {
    const targets = weightingTargets({
      district: DISTRICT,
      tractAdults: TRACTS,
      genderShares: { male: 0.48, female: 0.52 },
    })
    expect(targets.gender?.female).toBeCloseTo(0.52)
  })
})

describe('weighToCensus', () => {
  it('brings a sample that skews old and owner to the census mix', () => {
    const result = weighToCensus(
      [
        cell({ count: 40, ageBand: '65plus' }),
        cell({ count: 30, tract: '53017950200' }),
        cell({ count: 20, tenure: 'renter' }),
        cell({ count: 10, tenure: 'renter', tract: '53017950200' }),
      ],
      { district: DISTRICT, tractAdults: TRACTS },
    )
    expect(result.largestGap).toBeLessThan(0.01)
    expect(result.effectiveSampleSize).toBeLessThan(100)
    const old = result.gaps.find((gap) => gap.value === '65plus')
    expect(old?.unweightedShare).toBeCloseTo(0.4)
    expect(old?.share).toBeCloseTo(0.2, 1)
  })

  it('pools tracts with too few answers and leaves unreached areas as a gap', () => {
    const result = weighToCensus(
      [cell({ count: 50 }), cell({ count: 2, tract: '53017950200' })],
      {
        district: DISTRICT,
        tractAdults: new Map([...TRACTS, ['53017950300', 1_000]]),
      },
    )
    const pooled = result.gaps.find(
      (gap) => gap.dimension === 'tract' && gap.value === 'other',
    )
    expect(pooled?.censusShare).toBeCloseTo(0.7)
    expect(result.largestGap).toBeGreaterThan(0.1)
  })

  it('lets a respondent outside every known tract sit out neighborhood', () => {
    const result = weighToCensus(
      [cell({ count: 20, tract: '99999999999' }), cell({ count: 20 })],
      { district: DISTRICT, tractAdults: TRACTS },
    )
    expect(result.weights).toHaveLength(2)
  })
})
