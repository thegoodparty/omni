import { describe, expect, it } from 'vitest'
import filterSections, { legacyAgeOptions } from '../../shared/filters.config'
import { RECOMMENDED_LIST_FILTER_OPTION_KEYS } from './recommendedListFilters.config'
import {
  CLEARED_VOTER_FILE_FILTERS,
  LEGACY_AGE_CLEARED,
  hasAnyVoterFileSelection,
  segmentToVoterFileFilters,
  transformVoterFileFiltersForBackend,
  type VoterFileFilters,
} from './voterFileFilterTransform.util'

const ALL_OPTION_KEYS = [
  ...filterSections.flatMap((section) =>
    section.fields.flatMap((field) => field.options.map((opt) => opt.key)),
  ),
  ...RECOMMENDED_LIST_FILTER_OPTION_KEYS,
]

describe('segmentToVoterFileFilters', () => {
  it('round-trips every selectable option key through the backend shape', () => {
    const allSelected: VoterFileFilters = Object.fromEntries(
      ALL_OPTION_KEYS.map((key) => [key, true]),
    )

    const persisted = transformVoterFileFiltersForBackend(allSelected)

    expect(segmentToVoterFileFilters(persisted)).toEqual(allSelected)
  })

  it('round-trips a partial selection without inventing keys', () => {
    const selection: VoterFileFilters = {
      partyIndependent: true,
      genderFemale: true,
      languageSpanish: true,
      income50kTo75k: true,
      incomeUnknown: true,
    }

    const persisted = transformVoterFileFiltersForBackend(selection)

    expect(segmentToVoterFileFilters(persisted)).toEqual(selection)
  })

  it('reads a segment with no filters as an empty selection', () => {
    expect(segmentToVoterFileFilters({ id: 1, name: 'Everyone' })).toEqual({})
  })

  it('ignores non-boolean and false-valued persisted fields', () => {
    const filters = segmentToVoterFileFilters({
      id: 1,
      name: 'Mixed',
      partyDemocrat: false,
      partyRepublican: true,
      languageCodes: null,
      incomeRanges: undefined,
      search: 'martinez',
    })

    expect(filters).toEqual({ partyRepublican: true })
  })

  // ENG-10752's retired buckets don't map onto the current ones (legacy
  // 18-25 straddles 18-24 and 25-34), so a legacy list seeds no age pill and
  // LEGACY_AGE_CLEARED drops the stale columns on save — otherwise the saved
  // list would keep filtering on an age range the wizard never showed and the
  // live count never included.
  it('does not seed the retired age keys', () => {
    const filters = segmentToVoterFileFilters({
      id: 1,
      age18_25: true,
      age50Plus: true,
      partyOther: true,
    })

    expect(filters).toEqual({ partyOther: true })
  })

  it('clears every retired age key on save', () => {
    expect(LEGACY_AGE_CLEARED).toEqual(
      Object.fromEntries(legacyAgeOptions.map((option) => [option.key, false])),
    )
  })
})

describe('Imported in', () => {
  it('counts as a selection on its own', () => {
    expect(hasAnyVoterFileSelection({}, [], [], [], [], ['upload-1'])).toBe(
      true,
    )
    expect(hasAnyVoterFileSelection({}, [], [], [], [], [])).toBe(false)
  })

  // An edit sends the cleared baseline under the selection, so clearing
  // every import pill has to write an empty list rather than omit the key.
  it('is cleared by an edit that drops it', () => {
    expect(CLEARED_VOTER_FILE_FILTERS.contactUploadIds).toEqual([])
  })
})
