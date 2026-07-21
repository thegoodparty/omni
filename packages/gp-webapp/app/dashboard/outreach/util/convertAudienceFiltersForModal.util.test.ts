import { describe, it, expect } from 'vitest'
import { convertAudienceFiltersForModal } from './convertAudienceFiltersForModal.util'

describe('convertAudienceFiltersForModal', () => {
  it('converts camelCase VoterFileFilters into underscore audience state', () => {
    expect(
      convertAudienceFiltersForModal({
        audienceSuperVoters: true,
        partyDemocrat: false,
        age50Plus: true,
        genderUnknown: true,
      }),
    ).toEqual({
      audience_superVoters: true,
      party_democrat: false,
      age_50_plus: true,
      gender_unknown: true,
    })
  })

  it('ignores keys that are not part of the audience mapping', () => {
    expect(
      convertAudienceFiltersForModal({
        audienceSuperVoters: true,
        hasCellPhone: true,
        languageCodes: ['en'],
      }),
    ).toEqual({ audience_superVoters: true })
  })

  it('ignores non-boolean values for convertible keys', () => {
    expect(
      convertAudienceFiltersForModal({
        voterStatus: ['active'],
      }),
    ).toEqual({})
  })

  it('returns an empty object when no filters are provided', () => {
    expect(convertAudienceFiltersForModal()).toEqual({})
    expect(convertAudienceFiltersForModal({})).toEqual({})
  })
})
