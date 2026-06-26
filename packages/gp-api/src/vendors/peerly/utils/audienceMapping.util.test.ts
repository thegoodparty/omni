import { describe, expect, it } from 'vitest'
import {
  AudienceFieldsInput,
  mapAudienceFields,
  mapAudienceFieldsToCustomFilters,
} from './audienceMapping.util'

describe('mapAudienceFields', () => {
  it('maps the rich list fields backed by an L2 column', () => {
    expect(
      mapAudienceFields({
        hasCellPhone: true,
        hasLandline: true,
        ethnicityEuropean: true,
        ethnicityAsian: true,
        ethnicityHispanic: true,
        ethnicityAfricanAmerican: true,
      }),
    ).toEqual({
      has_cell_phone: true,
      has_landline: true,
      ethnicity_european: true,
      ethnicity_asian: true,
      ethnicity_hispanic: true,
      ethnicity_african_american: true,
    })
  })

  it('still maps the legacy audience/party/age/gender fields', () => {
    expect(
      mapAudienceFields({
        audienceSuperVoters: true,
        partyIndependent: true,
        age50Plus: true,
        genderFemale: true,
        ethnicityEuropean: true,
      }),
    ).toEqual({
      audience_superVoters: true,
      party_independent: true,
      age_50_plus: true,
      gender_female: true,
      ethnicity_european: true,
    })
  })

  it('omits unmapped persisted fields (income/education/etc.)', () => {
    // A saved VoterFileFilter carries rich fields that have no backing column
    // in the SMS voter-file query; they must be dropped, not silently passed
    // through to the Peerly CSV.
    const savedFilterShape = {
      hasCellPhone: true,
      incomeUnknown: true,
      educationCollegeDegree: true,
      veteranYes: true,
      married: true,
      hasChildrenYes: true,
      homeownerYes: true,
      languageCodes: ['English'],
    } as AudienceFieldsInput

    expect(mapAudienceFieldsToCustomFilters(savedFilterShape)).toEqual([
      'has_cell_phone',
    ])
  })
})
