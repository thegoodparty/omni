import { describe, expect, it } from 'vitest'
import {
  ACS_COUNT_KEYS,
  type AcsCounts,
} from '@/peopleDb/databricks/districtCensusSql.util'
import { adultAgeBandShares, adultSexShares } from './censusSexAge.util'

const counts = (overrides: Partial<AcsCounts> = {}): AcsCounts => ({
  ...(Object.fromEntries(ACS_COUNT_KEYS.map((key) => [key, 0])) as AcsCounts),
  ...overrides,
})

describe('adultSexShares', () => {
  it('splits adults by census sex', () => {
    const shares = adultSexShares(
      counts({ populationMale18Plus: 480, populationFemale18Plus: 520 }),
    )
    expect(shares?.male).toBeCloseTo(0.48)
    expect(shares?.female).toBeCloseTo(0.52)
  })

  it('is unknown when either sex is suppressed', () => {
    expect(
      adultSexShares(
        counts({ populationMale18Plus: null, populationFemale18Plus: 520 }),
      ),
    ).toBeNull()
  })

  it('is unknown for a district with no adults', () => {
    expect(adultSexShares(counts())).toBeNull()
  })
})

describe('adultAgeBandShares', () => {
  it('adds both sexes in each band', () => {
    const shares = adultAgeBandShares(
      counts({
        populationMale18To24: 50,
        populationFemale18To24: 50,
        populationMale65Plus: 100,
        populationFemale65Plus: 200,
        populationMale35To44: 300,
        populationFemale35To44: 300,
      }),
    )
    expect(shares?.['18to24']).toBeCloseTo(0.1)
    expect(shares?.['35to44']).toBeCloseTo(0.6)
    expect(shares?.['65plus']).toBeCloseTo(0.3)
    expect(shares?.['25to34']).toBe(0)
  })

  it('is unknown when any band is suppressed', () => {
    expect(
      adultAgeBandShares(
        counts({ populationMale18To24: 10, populationFemale55To64: null }),
      ),
    ).toBeNull()
  })
})
