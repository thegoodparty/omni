import { describe, expect, it } from 'vitest'
import {
  AGE_FILTER_KEY_RANGES,
  AGE_KEY_TO_PACK_BUCKETS,
  CURRENT_AGE_FILTER_KEYS,
  PACK_AGE_BANDS,
  PACK_AGE_BUCKETS,
  PACK_AGE_BUCKET_TO_BAND,
  PACK_AGE_UNKNOWN,
  encodeAgeBucket,
  type AgeFilterKey,
} from './PackAgeBuckets'

// Ages the pack could ever see, plus a margin either side of every boundary.
const AGES = Array.from({ length: 120 }, (_, age) => age)

const matchesKey = (key: AgeFilterKey, age: number): boolean => {
  const { min, max } = AGE_FILTER_KEY_RANGES[key]
  return age >= min && (max === null || age <= max)
}

const bucketOf = (age: number): string =>
  PACK_AGE_BUCKETS[encodeAgeBucket(age)] as string

describe('the pack age buckets', () => {
  // Pinned rather than derived, because the whole point of the derivation is
  // that nobody has to trust it: if a change to AGE_FILTER_KEY_RANGES re-cuts
  // these, that is a pack format change and this test is where it announces
  // itself.
  it('cuts at every boundary either generation of key uses', () => {
    expect(PACK_AGE_BUCKETS).toEqual([
      'Unknown',
      '18_24',
      '25',
      '26_34',
      '35',
      '36_49',
      '50',
      '51_64',
      '65_plus',
    ])
  })

  it('reads an age with no filter behind it as Unknown', () => {
    for (const age of [0, 1, 17]) expect(bucketOf(age)).toBe(PACK_AGE_UNKNOWN)
    expect(encodeAgeBucket(null)).toBe(0)
    expect(PACK_AGE_BUCKETS[0]).toBe(PACK_AGE_UNKNOWN)
  })

  it('assigns every adult age exactly one bucket', () => {
    for (const age of AGES.filter((a) => a >= 18)) {
      expect(bucketOf(age), `age ${age}`).not.toBe(PACK_AGE_UNKNOWN)
    }
  })

  // Encoding is a lookup table over a fixed age range, so the top of it needs
  // saying out loud: an absurd age is bad data, but `age50Plus` and
  // `age65Plus` are unbounded above and must not quietly stop matching at
  // whatever number the table happens to end on.
  it('keeps the open-ended bucket open, past any age a table can hold', () => {
    for (const age of [130, 131, 400, Number.MAX_SAFE_INTEGER]) {
      expect(bucketOf(age), `age ${age}`).toBe('65_plus')
    }
  })
})

// THE test. Every key, every age: the people a key's buckets shade on the map
// are exactly the people its range serves at knock time. Anything less is the
// two-denominator failure ADR 0010 forbids, and it is what the previous
// mapping did for age50_64 (shaded 50+, served 50-64) and age65Plus (shaded
// nothing at all).
describe('every age key maps onto its buckets exactly', () => {
  const keys = Object.keys(AGE_FILTER_KEY_RANGES) as AgeFilterKey[]

  it.each(keys)('%s', (key) => {
    const buckets = new Set(AGE_KEY_TO_PACK_BUCKETS[key])
    expect(buckets.size).toBeGreaterThan(0)
    for (const age of AGES) {
      expect(buckets.has(bucketOf(age)), `age ${age}`).toBe(
        matchesKey(key, age),
      )
    }
  })

  // The retired keys are the reason the single-year buckets exist. Spelling
  // their membership out is what makes "existing saved lists are unchanged"
  // checkable rather than asserted: ENG-10752's comment in
  // voterFileFilter.utils.ts says reinterpreting one would silently change an
  // existing list, and these are the exact bounds it protects.
  it.each([
    ['age18_25', ['18_24', '25']],
    ['age25_35', ['25', '26_34', '35']],
    ['age35_50', ['35', '36_49', '50']],
    ['age50Plus', ['50', '51_64', '65_plus']],
    ['age18_24', ['18_24']],
    ['age25_34', ['25', '26_34']],
    ['age35_49', ['35', '36_49']],
    ['age50_64', ['50', '51_64']],
    ['age65Plus', ['65_plus']],
  ] as const)('%s selects %j', (key, buckets) => {
    expect(AGE_KEY_TO_PACK_BUCKETS[key]).toEqual(buckets)
  })

  // The two that were wrong before this, called out by name so a regression
  // reads as one. age50Plus must never collapse to 50-64, and age65Plus must
  // never share a bucket set with age50_64 — mapping both to one band is what
  // made 65+ unshadeable in the first place.
  it('keeps 50+ and 65+ apart, and 50+ open-ended', () => {
    expect(AGE_KEY_TO_PACK_BUCKETS.age50Plus).toContain('65_plus')
    expect(AGE_KEY_TO_PACK_BUCKETS.age50_64).not.toContain('65_plus')
    expect(AGE_KEY_TO_PACK_BUCKETS.age65Plus).not.toContain('50')
    expect(AGE_KEY_TO_PACK_BUCKETS.age65Plus).not.toContain('51_64')
  })
})

describe('display bands', () => {
  it('is the current generation, named like buckets', () => {
    expect(PACK_AGE_BANDS).toEqual([
      '18_24',
      '25_34',
      '35_49',
      '50_64',
      '65_plus',
    ])
  })

  // A breakdown is rendered in these bands, so every bucket needs exactly
  // one — a bucket with no band would vanish from a breakdown that has to sum
  // to the people count printed above it.
  it('places every bucket in exactly one band', () => {
    for (const bucket of PACK_AGE_BUCKETS) {
      if (bucket === PACK_AGE_UNKNOWN) continue
      expect(PACK_AGE_BUCKET_TO_BAND[bucket], bucket).toBeDefined()
    }
    expect(new Set(Object.values(PACK_AGE_BUCKET_TO_BAND))).toEqual(
      new Set(PACK_AGE_BANDS),
    )
  })

  it('bands an age into a range that actually contains it', () => {
    const bandKey = new Map(
      CURRENT_AGE_FILTER_KEYS.map((key) => [
        PACK_AGE_BUCKET_TO_BAND[
          AGE_KEY_TO_PACK_BUCKETS[key][0] as string
        ] as string,
        key,
      ]),
    )
    for (const age of AGES.filter((a) => a >= 18)) {
      const band = PACK_AGE_BUCKET_TO_BAND[bucketOf(age)] as string
      const key = bandKey.get(band) as AgeFilterKey
      expect(matchesKey(key, age), `age ${age} banded as ${band}`).toBe(true)
    }
  })
})
