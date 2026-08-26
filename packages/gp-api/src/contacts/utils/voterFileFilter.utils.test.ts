import { describe, expect, it } from 'vitest'
import {
  AGE_FILTER_KEY_RANGES,
  AGE_KEY_TO_PACK_BUCKETS,
  PACK_AGE_BUCKETS,
  encodeAgeBucket,
} from '@goodparty_org/contracts'
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

// ADR 0010, for age. The door-knocking map shades from the pack's age buckets
// while knock time sends the `ageInt` bounds above to people-api, so the two
// have to select the same people for every key and every age — otherwise the
// count under the map and the list it previews are two answers to one
// question, which is worse than the honest "the map can't shade this" the
// disclosure used to give for 65+.
//
// Both sides now read one table (contracts' AGE_FILTER_KEY_RANGES): this
// conversion builds its ranges from it and PackAgeBuckets cuts the buckets
// from it. This is the test that the derivation on each side actually lands
// on the same people rather than merely sharing a source.
describe('the pack buckets and the ageInt bounds select the same people', () => {
  const AGES = Array.from({ length: 120 }, (_, age) => age)

  // Just enough of the people-api range grammar to evaluate what this
  // conversion emits for a single age key: one bound pair, or an _or of them.
  const servesAge = (filter: unknown, age: number): boolean => {
    const value = filter as {
      gte?: number
      lte?: number
      _or?: Array<{ gte?: number; lte?: number }>
    }
    const within = ({ gte, lte }: { gte?: number; lte?: number }) =>
      (gte === undefined || age >= gte) && (lte === undefined || age <= lte)
    return value._or ? value._or.some(within) : within(value)
  }

  const keys = Object.keys(AGE_FILTER_KEY_RANGES) as Array<
    keyof typeof AGE_FILTER_KEY_RANGES
  >

  it.each(keys)('%s', (key) => {
    const { ageInt } = convertVoterFileFilterToFilters({ [key]: true })
    const shaded = new Set(AGE_KEY_TO_PACK_BUCKETS[key])
    for (const age of AGES) {
      expect(
        shaded.has(PACK_AGE_BUCKETS[encodeAgeBucket(age)] as string),
        `age ${age}`,
      ).toBe(servesAge(ageInt, age))
    }
  })

  // A pack byte the filter cannot ask for would be a bucket the map can shade
  // and no list can serve. Under-18 rows are the exception BY DESIGN: no age
  // key matches them, and they encode as Unknown for exactly that reason.
  it('leaves no bucket that no key can select', () => {
    const selectable = new Set(
      keys.flatMap((key) => AGE_KEY_TO_PACK_BUCKETS[key]),
    )
    for (const bucket of PACK_AGE_BUCKETS) {
      if (bucket === 'Unknown') continue
      expect(selectable.has(bucket), bucket).toBe(true)
    }
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

// The precincts branch is the converter's most failure-prone path: the saved
// column is `precincts` but the filter key is `precinct`, and the filter
// accepts only `in`. Falling through to the generic array branch would emit
// `{ eq }` for a single selection, which PeopleFiltersSchema silently strips
// — turning a one-precinct list into the whole district.
describe('convertVoterFileFilterToFilters precincts', () => {
  it('renames the column to the filter key for a single selection', () => {
    expect(
      convertVoterFileFilterToFilters({ precincts: ['ORANGE|711'] }),
    ).toEqual({ precinct: { in: ['ORANGE|711'] } })
  })

  it('uses `in`, never `eq`, for a single selection', () => {
    const filters = convertVoterFileFilterToFilters({
      precincts: ['ORANGE|711'],
    })
    expect(filters.precinct).not.toHaveProperty('eq')
  })

  it('keeps every pair for a multi selection', () => {
    expect(
      convertVoterFileFilterToFilters({
        precincts: ['ORANGE|711', 'DADE|2'],
      }),
    ).toEqual({ precinct: { in: ['ORANGE|711', 'DADE|2'] } })
  })

  it('emits no precinct key at all for an empty array', () => {
    expect(
      convertVoterFileFilterToFilters({ precincts: [] }),
    ).not.toHaveProperty('precinct')
  })

  it('preserves the unknown bucket’s empty precinct side', () => {
    expect(
      convertVoterFileFilterToFilters({ precincts: ['HILLSBOROUGH|'] }),
    ).toEqual({ precinct: { in: ['HILLSBOROUGH|'] } })
  })
})
