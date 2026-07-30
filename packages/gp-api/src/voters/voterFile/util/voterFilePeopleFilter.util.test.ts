import { describe, expect, it } from 'vitest'
import { VoterFileType } from '../voterFile.types'
import { buildVoterFilePeopleFilter } from './voterFilePeopleFilter.util'

describe('buildVoterFilePeopleFilter', () => {
  it('maps legacy underscore filters to VoterFileFilter boolean fields', () => {
    const { filterInput, groupByHousehold } = buildVoterFilePeopleFilter(
      VoterFileType.custom,
      {
        filters: [
          'audience_superVoters',
          'party_independent',
          'age_18_25',
          'gender_female',
          'ethnicity_hispanic',
        ],
      },
    )

    expect(filterInput).toEqual({
      audienceSuperVoters: true,
      partyIndependent: true,
      age18_25: true,
      genderFemale: true,
      ethnicityHispanic: true,
    })
    expect(groupByHousehold).toBe(false)
  })

  it('ignores the audience_request UI sentinel', () => {
    const { filterInput } = buildVoterFilePeopleFilter(VoterFileType.custom, {
      filters: ['audience_request'],
    })

    expect(filterInput).toEqual({})
  })

  it.each([
    [VoterFileType.sms, { hasCellPhone: true }],
    [VoterFileType.digitalAds, { hasCellPhone: true }],
    [VoterFileType.telemarketing, { hasLandline: true }],
    [VoterFileType.robocall, { hasLandline: true }],
    [VoterFileType.full, {}],
    [VoterFileType.directMail, {}],
  ])('applies the %s channel population rule', (type, expected) => {
    const { filterInput, groupByHousehold } = buildVoterFilePeopleFilter(type)

    expect(filterInput).toEqual(expected)
    expect(groupByHousehold).toBe(false)
  })

  it('groups doorKnocking by household without a row filter', () => {
    const { filterInput, groupByHousehold } = buildVoterFilePeopleFilter(
      VoterFileType.doorKnocking,
    )

    expect(filterInput).toEqual({})
    expect(groupByHousehold).toBe(true)
  })

  it('merges channel rules with custom filters', () => {
    const { filterInput } = buildVoterFilePeopleFilter(VoterFileType.sms, {
      filters: ['party_democrat'],
    })

    expect(filterInput).toEqual({
      partyDemocrat: true,
      hasCellPhone: true,
    })
  })
})
