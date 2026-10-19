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
  weighToCensus,
  weightingTargets,
} from './censusWeighting.util'

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

describe('weighToCensus', () => {
  it('weighs race to the census, a folded group counting as other', () => {
    const result = weighToCensus(
      [
        cell({ count: 70, race: 'white' }),
        cell({ count: 10, race: 'black' }),
        cell({ count: 10, race: 'hispanic' }),
        cell({ count: 5, race: 'other' }),
        cell({ count: 5, race: 'asian' }),
        cell({ count: 5, race: null }),
      ],
      {
        district: { ...DISTRICT, ...RACE, populationAsianNh: 20 },
        tractAdults: TRACTS,
      },
    )
    const race = result.gaps.filter((gap) => gap.dimension === 'race')
    expect(race.map((gap) => gap.value).sort()).toEqual([
      'black',
      'hispanic',
      'other',
      'white',
    ])
    const other = race.find((gap) => gap.value === 'other')
    expect(other?.unweightedShare).toBeCloseTo(0.1)
    const black = race.find((gap) => gap.value === 'black')
    expect(black?.share).toBeGreaterThan(black?.unweightedShare ?? 1)
  })

  it('brings a sample that skews old and owner to the census mix', () => {
    const result = weighToCensus(
      [
        cell({ count: 30, ageBand: '65plus' }),
        cell({ count: 10, ageBand: '65plus', tenure: 'renter' }),
        ...(
          ['18to24', '25to34', '35to44', '45to54', '55to64'] as const
        ).flatMap((ageBand) => [
          cell({ count: 6, ageBand }),
          cell({ count: 6, ageBand, tenure: 'renter' }),
        ]),
      ],
      { district: DISTRICT, tractAdults: new Map() },
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

  it('pools age bands with too few answers rather than leaning on a handful', () => {
    const result = weighToCensus(
      [
        cell({ count: 30, ageBand: '65plus' }),
        cell({ count: 30, ageBand: '45to54' }),
        cell({ count: 2, ageBand: '18to24' }),
        cell({ count: 1, ageBand: '25to34' }),
      ],
      { district: DISTRICT, tractAdults: new Map() },
    )
    const pooled = result.gaps.find(
      (gap) => gap.dimension === 'age' && gap.value === 'other',
    )
    // 18-24, 25-34, 35-44 and 55-64 pool: 4 x 0.16 of the adults.
    expect(pooled?.censusShare).toBeCloseTo(0.64)
    expect(
      result.gaps.some(
        (gap) => gap.dimension === 'age' && gap.value === '18to24',
      ),
    ).toBe(false)
  })

  it('weights a sample that skews female to the census sex split, leaving blank Gender out', () => {
    const result = weighToCensus(
      [
        cell({ count: 70, gender: 'female' }),
        cell({ count: 30, gender: 'male' }),
        cell({ count: 10, gender: null }),
      ],
      {
        district: {
          ...DISTRICT,
          populationMale18Plus: 490,
          populationFemale18Plus: 510,
        },
        tractAdults: new Map(),
      },
    )
    const women = result.gaps.find((gap) => gap.value === 'female')
    expect(women?.unweightedShare).toBeCloseTo(0.7)
    expect(women?.share).toBeCloseTo(0.51, 2)
    expect(women?.censusShare).toBeCloseTo(0.51)
  })

  it('lets a respondent outside every known tract sit out neighborhood', () => {
    const result = weighToCensus(
      [cell({ count: 20, tract: '99999999999' }), cell({ count: 20 })],
      { district: DISTRICT, tractAdults: TRACTS },
    )
    expect(result.weights).toHaveLength(2)
  })
})
