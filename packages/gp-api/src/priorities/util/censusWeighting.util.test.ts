import { describe, expect, it } from 'vitest'
import {
  ACS_COUNT_KEYS,
  type AcsCountKey,
  type AcsCounts,
  type RespondentCell,
} from '@/peopleDb/databricks/districtCensusSql.util'
import {
  raceNameable,
  unreachedTracts,
  weightingTargets,
} from './censusWeighting.util'

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
  race: null,
  ...overrides,
})

const RACE = {
  populationWhiteNh: 600,
  populationBlackNh: 300,
  populationHispanic: 250,
  populationAsianNh: 60,
  populationNativeAmericanNh: 10,
  populationOtherNh: 30,
}

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

describe('weightingTargets race', () => {
  it('reads race over everyone, Native American joining other', () => {
    const targets = weightingTargets({
      district: { ...DISTRICT, ...RACE },
      tractAdults: TRACTS,
    })
    expect(targets.race?.white).toBeCloseTo(0.48)
    expect(targets.race?.black).toBeCloseTo(0.24)
    expect(targets.race?.hispanic).toBeCloseTo(0.2)
    expect(targets.race?.asian).toBeCloseTo(0.048)
    expect(targets.race?.other).toBeCloseTo(0.032)
  })

  it('folds a group under 2% of the district into other', () => {
    const targets = weightingTargets({
      district: { ...DISTRICT, ...RACE, populationAsianNh: 20 },
      tractAdults: TRACTS,
    })
    expect(targets.race?.asian).toBeUndefined()
    expect(targets.race?.other).toBeCloseTo(60 / 1_210)
  })

  it('leaves race out when a figure is suppressed', () => {
    const targets = weightingTargets({
      district: { ...DISTRICT, ...RACE, populationOtherNh: null },
      tractAdults: TRACTS,
    })
    expect(targets.race).toBeUndefined()
  })
})

describe('raceNameable', () => {
  it('needs 10 people with a known race', () => {
    expect(raceNameable([cell({ count: 9, race: 'black' })])).toBe(false)
    expect(raceNameable([cell({ count: 10, race: 'black' })])).toBe(true)
  })

  it('needs 70% of the people to have one', () => {
    expect(
      raceNameable([
        cell({ count: 69, race: 'white' }),
        cell({ count: 31, race: null }),
      ]),
    ).toBe(false)
    expect(
      raceNameable([
        cell({ count: 70, race: 'white' }),
        cell({ count: 30, race: null }),
      ]),
    ).toBe(true)
  })
})

describe('unreachedTracts', () => {
  it('names tracts answered at half their census share or less', () => {
    const tracts = new Map([
      ['a', 500],
      ['b', 300],
      ['c', 195],
      ['tiny', 5],
    ])
    expect(
      unreachedTracts(
        [
          cell({ count: 60, tract: 'a' }),
          cell({ count: 38, tract: 'b' }),
          cell({ count: 2, tract: 'c' }),
        ],
        tracts,
      ),
    ).toEqual(['c'])
  })

  it('names every tract when no answer is placed', () => {
    expect(unreachedTracts([cell({ count: 5, tract: null })], TRACTS)).toEqual([
      '53017950100',
      '53017950200',
    ])
  })
})
