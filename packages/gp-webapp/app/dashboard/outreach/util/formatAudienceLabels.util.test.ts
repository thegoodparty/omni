import { describe, expect, it } from 'vitest'
import { formatAudienceLabels } from './formatAudienceLabels.util'

describe('formatAudienceLabels', () => {
  it('maps selected audience filters to their display labels', () => {
    expect(
      formatAudienceLabels({
        audienceSuperVoters: true,
        partyIndependent: true,
        age18_25: true,
        genderFemale: true,
      }),
    ).toEqual(['Super', 'Independent', '18-25', 'Female'])
  })

  it('emits labels in the canonical audience order regardless of input order', () => {
    expect(
      formatAudienceLabels({
        genderMale: true,
        age50Plus: true,
        audienceLikelyVoters: true,
      }),
    ).toEqual(['Likely', '50+', 'Male'])
  })

  it('skips unselected filters and unrelated keys', () => {
    expect(
      formatAudienceLabels({
        audienceSuperVoters: true,
        audienceLikelyVoters: false,
        hasCellPhone: true,
      }),
    ).toEqual(['Super'])
  })

  it('returns an empty array when nothing is selected', () => {
    expect(formatAudienceLabels()).toEqual([])
    expect(formatAudienceLabels({})).toEqual([])
  })

  it('labels legacy age keys with their original ranges', () => {
    expect(formatAudienceLabels({ age18_25: true, age50Plus: true })).toEqual([
      '18-25',
      '50+',
    ])
  })

  it('labels the new exclusive age keys so CRM-built lists are not blank', () => {
    expect(
      formatAudienceLabels({
        age18_24: true,
        age25_34: true,
        age35_49: true,
        age50_64: true,
        age65Plus: true,
      }),
    ).toEqual(['18-24', '25-34', '35-49', '50-64', '65+'])
  })

  it('mixes audience, party, and age labels in key order', () => {
    expect(
      formatAudienceLabels({
        audienceUnknown: true,
        partyIndependent: true,
        age65Plus: true,
        genderFemale: true,
      }),
    ).toEqual(['Unknown Voters', 'Independent', '65+', 'Female'])
  })
})
