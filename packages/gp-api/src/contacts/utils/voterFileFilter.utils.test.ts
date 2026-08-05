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

  it('emits _or bounds for non-contiguous ranges instead of bridging the gap', () => {
    expect(
      convertVoterFileFilterToFilters({ age18_24: true, age50_64: true }),
    ).toEqual({
      ageInt: {
        _or: [
          { gte: 18, lte: 24 },
          { gte: 50, lte: 64 },
        ],
      },
    })
  })

  it('keeps an unbounded range open-ended inside a non-contiguous union', () => {
    expect(
      convertVoterFileFilterToFilters({ age18_24: true, age65Plus: true }),
    ).toEqual({
      ageInt: {
        _or: [{ gte: 18, lte: 24 }, { gte: 65 }],
      },
    })
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

describe('convertVoterFileFilterToFilters voter status', () => {
  it('maps an Unreliable selection to Unreliable alone', () => {
    expect(
      convertVoterFileFilterToFilters({ audienceUnreliableVoters: true }),
    ).toEqual({ voterStatus: { eq: 'Unreliable' } })
  })

  it('keeps Unreliable and Unknown distinct when both are selected', () => {
    expect(
      convertVoterFileFilterToFilters({
        audienceUnreliableVoters: true,
        audienceUnknown: true,
      }),
    ).toEqual({ voterStatus: { in: ['Unreliable', 'Unknown'] } })
  })

  it('maps a single non-Unreliable selection with eq', () => {
    expect(
      convertVoterFileFilterToFilters({ audienceSuperVoters: true }),
    ).toEqual({ voterStatus: { eq: 'Super' } })
  })

  it('passes a raw voterStatus array through unexpanded', () => {
    expect(
      convertVoterFileFilterToFilters({ voterStatus: ['Unreliable'] }),
    ).toEqual({ voterStatus: { eq: 'Unreliable' } })
  })
})
