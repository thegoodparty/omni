import { describe, expect, it } from 'vitest'
import { convertVoterFileFilterToFilters } from './voterFileFilter.utils'

// ENG-10752: the wizard offers mutually exclusive ranges; rows saved before
// the change keep the exact (overlapping) bounds they were created with.
const NEW_KEY_BOUNDS = [
  { key: 'age18_24', filter: { age18_24: true }, bounds: { gte: 18, lte: 24 } },
  { key: 'age25_34', filter: { age25_34: true }, bounds: { gte: 25, lte: 34 } },
  { key: 'age35_49', filter: { age35_49: true }, bounds: { gte: 35, lte: 49 } },
  { key: 'age50_64', filter: { age50_64: true }, bounds: { gte: 50, lte: 64 } },
  { key: 'age65Plus', filter: { age65Plus: true }, bounds: { gte: 65 } },
]

const LEGACY_KEY_BOUNDS = [
  { key: 'age18_25', filter: { age18_25: true }, bounds: { gte: 18, lte: 25 } },
  { key: 'age25_35', filter: { age25_35: true }, bounds: { gte: 25, lte: 35 } },
  { key: 'age35_50', filter: { age35_50: true }, bounds: { gte: 35, lte: 50 } },
  { key: 'age50Plus', filter: { age50Plus: true }, bounds: { gte: 50 } },
]

describe('convertVoterFileFilterToFilters age ranges', () => {
  it.each(NEW_KEY_BOUNDS)(
    'converts new key $key to inclusive bounds $bounds',
    ({ filter, bounds }) => {
      expect(convertVoterFileFilterToFilters(filter)).toEqual({
        ageInt: bounds,
      })
    },
  )

  it.each(LEGACY_KEY_BOUNDS)(
    'keeps legacy key $key on its original bounds $bounds',
    ({ filter, bounds }) => {
      expect(convertVoterFileFilterToFilters(filter)).toEqual({
        ageInt: bounds,
      })
    },
  )

  it('places every boundary age in exactly one new bucket', () => {
    const boundaryAges = [18, 24, 25, 34, 35, 49, 50, 64, 65, 90]
    for (const age of boundaryAges) {
      const matches = NEW_KEY_BOUNDS.filter(
        ({ bounds }) =>
          age >= bounds.gte && (bounds.lte === undefined || age <= bounds.lte),
      )
      expect(matches, `age ${age}`).toHaveLength(1)
    }
  })

  it('collapses all five new ranges to an 18+ query', () => {
    expect(
      convertVoterFileFilterToFilters({
        age18_24: true,
        age25_34: true,
        age35_49: true,
        age50_64: true,
        age65Plus: true,
      }),
    ).toEqual({ ageInt: { gte: 18 } })
  })

  it('merges adjacent new ranges into one contiguous bound', () => {
    expect(
      convertVoterFileFilterToFilters({ age18_24: true, age25_34: true }),
    ).toEqual({ ageInt: { gte: 18, lte: 34 } })
  })

  it('enumerates non-contiguous new ranges instead of bridging the gap', () => {
    const filters = convertVoterFileFilterToFilters({
      age18_24: true,
      age50_64: true,
    })
    const expectedAges = [
      ...Array.from({ length: 7 }, (_, i) => 18 + i),
      ...Array.from({ length: 15 }, (_, i) => 50 + i),
    ]
    expect(filters).toEqual({ ageInt: { in: expectedAges } })
  })

  it('unions a legacy and a new range without reinterpreting either', () => {
    expect(
      convertVoterFileFilterToFilters({ age18_25: true, age25_34: true }),
    ).toEqual({ ageInt: { gte: 18, lte: 34 } })
  })

  it('adds _includeNull when ageUnknown accompanies a new range', () => {
    expect(
      convertVoterFileFilterToFilters({ age65Plus: true, ageUnknown: true }),
    ).toEqual({ ageInt: { gte: 65, _includeNull: true } })
  })
})
