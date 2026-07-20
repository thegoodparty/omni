import { describe, expect, it } from 'vitest'
import { formatAudienceLabels } from './formatAudienceLabels.util'

describe('formatAudienceLabels', () => {
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
        audienceFirstTimeVoters: true,
        partyIndependent: true,
        age65Plus: true,
        genderFemale: true,
      }),
    ).toEqual(['First Time', 'Independent', '65+', 'Female'])
  })
})
