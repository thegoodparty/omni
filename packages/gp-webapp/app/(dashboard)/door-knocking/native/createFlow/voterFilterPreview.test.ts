import { describe, expect, it } from 'vitest'
import {
  DoorKnockingPackManifest,
  PACK_AGE_BUCKETS,
} from '@goodparty_org/contracts'
import { filtersToDimSelections } from './voterFilterPreview'

const manifest = {
  version: 1,
  generatedAt: '2026-07-21T00:00:00Z',
  counts: { people: 4, households: 4, dots: 4 },
  dims: [
    { key: 'party', values: ['Democratic', 'Republican', 'Independent'] },
    { key: 'age', values: [...PACK_AGE_BUCKETS] },
    { key: 'gender', values: ['M', 'F', 'unknown'] },
  ],
  arrays: [],
} as unknown as DoorKnockingPackManifest

// A pack built before the age re-cut, which a browser can hold across a
// deploy. Both vocabularies are listed in the mapping and no pack has both.
const legacyManifest = {
  ...manifest,
  dims: manifest.dims.map((dim) =>
    dim.key === 'age'
      ? {
          key: 'age',
          values: ['Unknown', '18_25', '25_35', '35_50', '50_plus'],
        }
      : dim,
  ),
} as typeof manifest

const ageBuckets = (
  filters: Record<string, boolean>,
  from: typeof manifest = manifest,
): string[] => {
  const dim = from.dims.find((entry) => entry.key === 'age')
  const selected = filtersToDimSelections(filters, from).get('age')
  return selected
    ? [...selected].sort((a, b) => a - b).map((index) => dim!.values[index]!)
    : []
}

describe('filtersToDimSelections', () => {
  it('narrows only the dims the draft touches', () => {
    const selections = filtersToDimSelections(
      { partyDemocrat: true, genderFemale: true },
      manifest,
    )
    expect(selections.get('party')).toEqual(new Set([0]))
    expect(selections.get('gender')).toEqual(new Set([1]))
    expect(selections.has('age')).toBe(false)
  })

  // The pack's buckets are cut at every boundary both generations of age key
  // use, so a key spans several — and the preview has to select ALL of them.
  // Selecting the first would shade a fraction of the list; selecting a
  // nearest single bucket is what made 65+ unshadeable before this.
  describe('age', () => {
    it.each([
      ['age18_24', ['18_24']],
      ['age25_34', ['25', '26_34']],
      ['age35_49', ['35', '36_49']],
      ['age50_64', ['50', '51_64']],
      ['age65Plus', ['65_plus']],
    ])('shades %s as %j', (key, buckets) => {
      expect(ageBuckets({ [key]: true })).toEqual(buckets)
    })

    // The retired keys ENG-10752 replaced. A list saved with one of them
    // targets its ORIGINAL bounds at knock time, so the map has to shade
    // those — age50Plus is 50+, not 50-64.
    it.each([
      ['age18_25', ['18_24', '25']],
      ['age25_35', ['25', '26_34', '35']],
      ['age35_50', ['35', '36_49', '50']],
      ['age50Plus', ['50', '51_64', '65_plus']],
    ])('shades the retired %s as %j', (key, buckets) => {
      expect(ageBuckets({ [key]: true })).toEqual(buckets)
    })

    // The bug this PR exists for, from both ends: the two keys must not shade
    // the same people, and 65+ must shade somebody at all.
    it('separates 50-64 from 65+', () => {
      expect(ageBuckets({ age50_64: true })).not.toContain('65_plus')
      expect(ageBuckets({ age65Plus: true })).toEqual(['65_plus'])
    })

    it('unions overlapping selections without double-counting', () => {
      expect(ageBuckets({ age18_25: true, age25_34: true })).toEqual([
        '18_24',
        '25',
        '26_34',
      ])
    })

    describe('against a pack built before the re-cut', () => {
      it.each([
        ['age18_25', ['18_25']],
        ['age50Plus', ['50_plus']],
        ['age18_24', ['18_25']],
      ])('still shades %s as %j', (key, buckets) => {
        expect(ageBuckets({ [key]: true }, legacyManifest)).toEqual(buckets)
      })

      // The old buckets stop at 50, so the nearest match for either of these
      // is `50_plus` — which shades 65+ people a 50-64 list will not knock.
      // Disclosing beats over-shading; `age50_64 -> 50_plus` was the previous
      // behavior and it was a silent superset.
      it.each(['age50_64', 'age65Plus'])('narrows nothing for %s', (key) => {
        expect(ageBuckets({ [key]: true }, legacyManifest)).toEqual([])
      })
    })
  })

  it('maps income pills through the shared range names', () => {
    const withIncome = {
      ...manifest,
      dims: [
        ...manifest.dims,
        { key: 'income', values: ['Unknown', 'Under $25k', '$200k+'] },
      ],
    } as typeof manifest
    const selections = filtersToDimSelections(
      { incomeUnder25k: true, income200kPlus: true },
      withIncome,
    )
    expect(selections.get('income')).toEqual(new Set([1, 2]))
  })

  it('ignores unknown keys and dims absent from the manifest', () => {
    const selections = filtersToDimSelections(
      { educationSomeCollege: true, notARealFilterKey: true },
      manifest, // has no educationLevel dim
    )
    expect(selections.size).toBe(0)
  })

  // Prior contacts made is the campaign's own outreach history rather than a
  // voter attribute, so it rides a plane gp-api joins per organization. The
  // bucket names ARE the pill labels, so nothing translates between them.
  describe('prior contacts made', () => {
    const withPlane = {
      ...manifest,
      dims: [
        ...manifest.dims,
        { key: 'contactsMade', values: ['0', '1', '2', '3', '4', '5+'] },
      ],
    } as typeof manifest

    it('shades the selected buckets when the pack carries the plane', () => {
      const selections = filtersToDimSelections(
        { contactsMade0: true, contactsMade5Plus: true },
        withPlane,
      )
      expect(selections.get('contactsMade')).toEqual(new Set([0, 5]))
    })

    // The plane is omitted for an organization with more contacted people
    // than one pack can describe (PACK_CONTACTS_MADE_MAX). Without it the
    // selection narrows nothing, which is the honest answer: an empty
    // allowed set would shade an empty map instead.
    it('narrows nothing when the pack has no plane', () => {
      expect(
        filtersToDimSelections({ contactsMade0: true }, manifest).size,
      ).toBe(0)
    })
  })

  // A key whose buckets are all missing must add NO entry rather than an
  // empty set: an empty set allows nothing, which would shade an empty map
  // for a filter the pack simply cannot express.
  it('never leaves a dim with an empty allowed set', () => {
    const selections = filtersToDimSelections(
      { age65Plus: true },
      legacyManifest,
    )
    for (const allowed of selections.values()) {
      expect(allowed.size).toBeGreaterThan(0)
    }
  })
})

describe('precinct', () => {
  // The one dim whose vocabulary is the district's own data rather than a
  // closed enum, so the selection's values ARE the bucket names.
  const withPrecinct = {
    ...manifest,
    dims: [
      ...manifest.dims,
      {
        key: 'precinct',
        values: ['Unknown', 'Brevard|300', 'Brevard|301', 'Orange|300'],
      },
    ],
  } as typeof manifest

  it('narrows by the pairs the list was cut to', () => {
    const selections = filtersToDimSelections({}, withPrecinct, [
      'Brevard|300',
      'Orange|300',
    ])

    expect(selections.get('precinct')).toEqual(new Set([1, 3]))
  })

  it('adds no entry when this pack carries no precinct plane', () => {
    // A district past the picker's ceiling gets no plane. "We can't express
    // this" has to mean "don't constrain" — an empty set would allow
    // nothing and shade an empty map, which is a confidently wrong answer
    // where the disclosure is an honest one.
    const selections = filtersToDimSelections({}, manifest, ['Brevard|300'])

    expect(selections.has('precinct')).toBe(false)
  })
})
