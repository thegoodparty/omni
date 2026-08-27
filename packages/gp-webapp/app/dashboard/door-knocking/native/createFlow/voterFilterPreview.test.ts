import { describe, expect, it } from 'vitest'
import {
  DoorKnockingPackManifest,
  PACK_AGE_BUCKETS,
} from '@goodparty_org/contracts'
import {
  filtersToDimSelections,
  unpreviewableDisclosureLabels,
  unpreviewableDisclosureSentence,
  unpreviewableFilterKeys,
} from './voterFilterPreview'

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
      expect(unpreviewableFilterKeys({ age65Plus: true }, manifest)).toEqual([])
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
      it.each(['age50_64', 'age65Plus'])('discloses %s instead', (key) => {
        expect(ageBuckets({ [key]: true }, legacyManifest)).toEqual([])
        expect(
          unpreviewableFilterKeys({ [key]: true }, legacyManifest),
        ).toEqual([key])
      })
    })
  })

  // Silently previewing a superset is the bug, so the keys that can't narrow
  // are reportable rather than just dropped.
  describe('unpreviewableFilterKeys', () => {
    it('reports selections the pack has no bucket for', () => {
      expect(
        unpreviewableFilterKeys(
          { partyDemocrat: true, veteranYes: true },
          manifest,
        ),
      ).toEqual(['veteranYes'])
    })

    it('ignores unselected options and reports nothing when all map', () => {
      expect(
        unpreviewableFilterKeys(
          { partyDemocrat: true, age65Plus: true, genderFemale: true },
          manifest,
        ),
      ).toEqual([])
    })

    // A dim missing from the manifest entirely, not just a missing bucket.
    it('reports a selection whose whole dim is absent from the pack', () => {
      expect(unpreviewableFilterKeys({ veteranYes: true }, manifest)).toEqual([
        'veteranYes',
      ])
    })

    // The marks `savedListFilterKeys` leaves for a list's non-boolean
    // criteria. They are ordinary keys here on purpose — the pack has no plane
    // for any of them, which is exactly what this function reports.
    it('reports a list’s support-status, activity and precinct clauses', () => {
      expect(
        unpreviewableFilterKeys(
          {
            partyDemocrat: true,
            supportStatus: true,
            activityConditions: true,
            precincts: true,
          },
          manifest,
        ),
      ).toEqual(['supportStatus', 'activityConditions', 'precincts'])
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
      expect(
        unpreviewableFilterKeys({ contactsMade0: true }, withPlane),
      ).toEqual([])
    })

    // The plane is omitted for an organization with more contacted people
    // than one pack can describe (PACK_CONTACTS_MADE_MAX). That org's pills
    // fall back to the disclosure — which is why the group's fallback label
    // survives the plane shipping.
    it('falls back to the disclosure when the pack has no plane', () => {
      expect(
        filtersToDimSelections({ contactsMade0: true }, manifest).size,
      ).toBe(0)
      expect(
        unpreviewableFilterKeys({ contactsMade0: true }, manifest),
      ).toEqual(['contactsMade0'])
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

describe('unpreviewableDisclosureLabels', () => {
  it('names the option for a group whose labels stand on their own', () => {
    expect(unpreviewableDisclosureLabels(['age65Plus'])).toEqual(['65+'])
  })

  // A list's non-boolean criteria have no row in filters.config to take a
  // label from, so they carried none — which silently dropped them back out
  // of the sentence they had just been added to.
  it('names a list’s own criteria, which no pill group covers', () => {
    expect(
      unpreviewableDisclosureLabels([
        'supportStatus',
        'activityConditions',
        'precincts',
      ]),
    ).toEqual(['Support status', 'Past outreach activity', 'Precinct'])
  })

  it('still says nothing for a key that names no filter at all', () => {
    expect(unpreviewableDisclosureLabels(['notARealFilterKey'])).toEqual([])
  })
})

// The sentence was written for exactly one filter and then had a
// `labels.join(', ')` dropped into it, so a second selection produced "shade
// by 65+, Prior contacts made yet, so these counts include people that filter
// will exclude" — a comma list that reads as a typo, a "yet" that attaches
// itself to the last label, and a singular pronoun for a plural subject.
describe('unpreviewableDisclosureSentence', () => {
  // The whole sentence, once, so the wording the three surfaces share is
  // pinned somewhere: it must name the MAP as the limitation and say the list
  // still applies the filter (AGENTS.md, ADR 0010). Phrased as the filter not
  // being applied, it reads as targeting silently failing.
  it('keeps the singular sentence for one filter', () => {
    expect(unpreviewableDisclosureSentence(['65+'])).toBe(
      'The map can’t yet shade by 65+, so these counts include people that ' +
        'filter will exclude. Your saved list still applies it when you knock.',
    )
  })

  it('joins two with or, with no comma to read as a typo', () => {
    expect(
      unpreviewableDisclosureSentence(['65+', 'Prior contacts made']),
    ).toBe(
      'The map can’t yet shade by 65+ or Prior contacts made, so these ' +
        'counts include people those filters will exclude. Your saved list ' +
        'still applies them when you knock.',
    )
  })

  // Three or more keeps the serial comma: without it the last two labels run
  // together into something that reads as one filter name.
  it('joins three or more with commas and a final or', () => {
    expect(
      unpreviewableDisclosureSentence(['65+', 'Renter', 'Prior contacts made']),
    ).toBe(
      'The map can’t yet shade by 65+, Renter, or Prior contacts made, so ' +
        'these counts include people those filters will exclude. Your saved ' +
        'list still applies them when you knock.',
    )

    expect(
      unpreviewableDisclosureSentence(['65+', 'Renter', 'Veteran', 'Married']),
    ).toContain('shade by 65+, Renter, Veteran, or Married,')
  })

  // Not an empty paragraph: the callers render nothing rather than a hedge
  // about no filters.
  it('has nothing to say when every filter shades', () => {
    expect(unpreviewableDisclosureSentence([])).toBeNull()
  })

  // The create flow reaches this sentence before any list exists, so the
  // closing clause must not cite one. It still has to promise the filter gets
  // applied — ending on "that filter will exclude" is the reading ADR 0010
  // exists to prevent — so the subject changes and the reassurance stays.
  it('does not claim a saved list when none is picked', () => {
    const sentence = unpreviewableDisclosureSentence(['65+'], false)
    expect(sentence).toBe(
      'The map can’t yet shade by 65+, so these counts include people that ' +
        'filter will exclude. Your list still applies it when you knock.',
    )
    expect(sentence).not.toContain('saved list')
    expect(sentence).toContain('still applies it when you knock')
  })

  it('keeps the plural pronoun when no list is picked', () => {
    expect(
      unpreviewableDisclosureSentence(['65+', 'Prior contacts made'], false),
    ).toContain('Your list still applies them when you knock.')
  })

  // The details sheet and the landing rail describe a list that exists and
  // never pass the flag, so the saved wording has to be what omitting it means.
  it('defaults to the saved-list wording for the surfaces that omit the flag', () => {
    expect(unpreviewableDisclosureSentence(['65+'])).toContain(
      'Your saved list still applies it when you knock.',
    )
  })
})
