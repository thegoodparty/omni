import { describe, expect, it } from 'vitest'
import { DoorKnockingPackManifest } from '@goodparty_org/contracts'
import { filtersToDimSelections } from './voterFilterPreview'

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
      { age18_24: true, age65Plus: true },
      manifest,
    )
    expect(selections.get('age')).toEqual(new Set([0, 3]))
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
