import { describe, it, expect } from 'vitest'
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
})
