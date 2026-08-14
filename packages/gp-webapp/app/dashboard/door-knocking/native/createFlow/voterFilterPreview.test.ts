import { describe, expect, it } from 'vitest'
import { DoorKnockingPackManifest } from '@goodparty_org/contracts'
import {
  filtersToDimSelections,
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
