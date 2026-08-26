import { describe, expect, it } from 'vitest'
import { DoorKnockingPackManifest } from '@goodparty_org/contracts'
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
    { key: 'age', values: ['18_25', '25_35', '35_50', '50_plus'] },
    { key: 'gender', values: ['M', 'F', 'unknown'] },
  ],
  arrays: [],
} as unknown as DoorKnockingPackManifest

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

  it('maps the exclusive age picker onto the pack legacy buckets', () => {
    const selections = filtersToDimSelections(
      { age18_24: true, age50_64: true },
      manifest,
    )
    expect(selections.get('age')).toEqual(new Set([0, 3]))
  })

  it('65+ does not narrow: the legacy buckets cannot express it', () => {
    const selections = filtersToDimSelections({ age65Plus: true }, manifest)
    expect(selections.has('age')).toBe(false)
  })

  // The other half of the 65+ case: silently previewing a superset is the bug,
  // so the keys that can't narrow are reportable rather than just dropped.
  describe('unpreviewableFilterKeys', () => {
    it('reports selections the pack has no bucket for', () => {
      expect(
        unpreviewableFilterKeys(
          { partyDemocrat: true, age65Plus: true },
          manifest,
        ),
      ).toEqual(['age65Plus'])
    })

    it('ignores unselected options and reports nothing when all map', () => {
      expect(
        unpreviewableFilterKeys(
          { partyDemocrat: true, age65Plus: false, genderFemale: true },
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
})
