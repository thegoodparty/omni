import { describe, expect, it } from 'vitest'
import {
  ACS_COUNT_KEYS,
  type AcsCountKey,
  type AcsCounts,
  type RespondentCell,
} from '@/peopleDb/databricks/districtCensusSql.util'
import { raceNameable, weightingTargets } from './censusWeighting.util'

const acs = (overrides: Partial<Record<AcsCountKey, number>>): AcsCounts =>
  Object.fromEntries(
    ACS_COUNT_KEYS.map((key) => [key, overrides[key] ?? 0]),
  ) as AcsCounts

// 1,000 adults: 160 in each band under 65 (80 men, 80 women) and 200 at 65
// and over.
const DISTRICT = acs({
  populationMale18To24: 80,
  populationFemale18To24: 80,
  populationMale25To34: 80,
  populationFemale25To34: 80,
  populationMale35To44: 80,
  populationFemale35To44: 80,
  populationMale45To54: 80,
  populationFemale45To54: 80,
  populationMale55To64: 80,
  populationFemale55To64: 80,
  populationMale65Plus: 100,
  populationFemale65Plus: 100,
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
  ageBand: '35to44',
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
    expect(targets.age?.['18to24']).toBeCloseTo(0.16)
    expect(Object.keys(targets.age ?? {})).toHaveLength(6)
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

  it('reads gender from the adult census sex totals', () => {
    const targets = weightingTargets({
      district: {
        ...DISTRICT,
        populationMale18Plus: 480,
        populationFemale18Plus: 520,
      },
      tractAdults: TRACTS,
    })
    expect(targets.gender?.male).toBeCloseTo(0.48)
    expect(targets.gender?.female).toBeCloseTo(0.52)
  })

  it('leaves gender out when the census suppressed either sex', () => {
    const targets = weightingTargets({
      district: {
        ...DISTRICT,
        populationMale18Plus: null,
        populationFemale18Plus: 520,
      },
      tractAdults: TRACTS,
    })
    expect(targets.gender).toBeUndefined()
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
