import { describe, expect, it } from 'vitest'
import {
  ACS_COUNT_KEYS,
  type AcsCounts,
  type DistrictCell,
} from '@/peopleDb/databricks/districtCensusSql.util'
import { censusFrame } from './censusFrame.util'

const zero = Object.fromEntries(
  ACS_COUNT_KEYS.map((key) => [key, 0]),
) as AcsCounts

// Adults: a quarter 18 to 24, three quarters 65 and over; half each sex.
const CENSUS: AcsCounts = {
  ...zero,
  populationMale18To24: 100,
  populationFemale18To24: 100,
  populationMale65Plus: 300,
  populationFemale65Plus: 300,
  populationMale18Plus: 400,
  populationFemale18Plus: 400,
}

const cell = (
  ageBand: DistrictCell['ageBand'],
  gender: DistrictCell['gender'],
  tract: string | null,
  count: number,
  race: DistrictCell['race'] = null,
): DistrictCell => ({ ageBand, gender, tract, race, count })

// Voter file: 80% young, which the census says is 25%.
const VOTER_FILE = [
  cell('18to24', 'male', 'a', 40),
  cell('18to24', 'female', 'a', 40),
  cell('65plus', 'male', 'b', 10),
  cell('65plus', 'female', 'b', 10),
]

const shareOf = (
  cells: DistrictCell[],
  pick: (c: DistrictCell) => string | null,
  value: string,
): number => {
  const total = cells.reduce((sum, c) => sum + c.count, 0)
  return (
    cells.filter((c) => pick(c) === value).reduce((s, c) => s + c.count, 0) /
    total
  )
}

describe('censusFrame', () => {
  it('takes age band and sex margins from the census, not the voter file', () => {
    const { cells, fromVoterFile } = censusFrame(VOTER_FILE, {
      district: CENSUS,
      tractAdults: new Map(),
    })

    expect(shareOf(cells, (c) => c.ageBand, '18to24')).toBeCloseTo(0.25)
    expect(shareOf(cells, (c) => c.ageBand, '65plus')).toBeCloseTo(0.75)
    expect(shareOf(cells, (c) => c.gender, 'male')).toBeCloseTo(0.5)
    expect(fromVoterFile).toEqual(['tract'])
  })

  it('takes tract margins from the census adults per tract', () => {
    const { cells, fromVoterFile } = censusFrame(VOTER_FILE, {
      district: CENSUS,
      tractAdults: new Map([
        ['a', 250],
        ['b', 750],
      ]),
    })

    expect(shareOf(cells, (c) => c.tract, 'a')).toBeCloseTo(0.25)
    expect(shareOf(cells, (c) => c.tract, 'b')).toBeCloseTo(0.75)
    expect(fromVoterFile).toEqual([])
  })

  it('keeps the voter file for a dimension the census suppressed', () => {
    const { cells, fromVoterFile } = censusFrame(VOTER_FILE, {
      district: { ...CENSUS, populationFemale65Plus: null },
      tractAdults: new Map(),
    })

    expect(shareOf(cells, (c) => c.ageBand, '18to24')).toBeCloseTo(0.8)
    expect(shareOf(cells, (c) => c.gender, 'male')).toBeCloseTo(0.5)
    expect(fromVoterFile).toEqual(['age', 'tract'])
  })

  it('keeps every voter file count when the census has nothing', () => {
    const { cells, fromVoterFile } = censusFrame(VOTER_FILE, {
      district: zero,
      tractAdults: new Map(),
    })

    expect(cells).toEqual(VOTER_FILE)
    expect(fromVoterFile).toEqual(['age', 'gender', 'tract'])
  })

  it('keeps people with an unknown value, sitting out that dimension', () => {
    const { cells } = censusFrame(
      [...VOTER_FILE, cell('65plus', null, null, 20)],
      { district: CENSUS, tractAdults: new Map() },
    )

    const unknown = cells.find((c) => c.gender === null)
    expect(unknown?.count).toBeGreaterThan(0)
  })

  it('places a tract the census has no adults for as unknown', () => {
    const { cells } = censusFrame(VOTER_FILE, {
      district: CENSUS,
      tractAdults: new Map([['a', 100]]),
    })

    expect(cells.filter((c) => c.tract === 'b')).toEqual([])
    expect(cells.some((c) => c.tract === null)).toBe(true)
  })

  it('leaves race with the voter file', () => {
    const { cells } = censusFrame(
      [
        cell('18to24', 'male', null, 50, 'white'),
        cell('18to24', 'female', null, 50, 'white'),
        cell('65plus', 'male', null, 50, 'black'),
        cell('65plus', 'female', null, 50, 'black'),
      ],
      { district: CENSUS, tractAdults: new Map() },
    )

    expect(cells.filter((c) => c.race === 'white')).toHaveLength(2)
    expect(shareOf(cells, (c) => c.race, 'white')).toBeCloseTo(0.25)
  })
})
