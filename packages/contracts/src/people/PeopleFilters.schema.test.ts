import { describe, expect, it } from 'vitest'
import { PeopleFiltersSchema } from './PeopleFilters.schema'

const ID = '0b3f1c1e-8f7a-4c1b-9d2e-3a4b5c6d7e8f'

describe('PeopleFiltersSchema votedInElection', () => {
  it('accepts Yes or No with the campaign-recorded ids', () => {
    expect(
      PeopleFiltersSchema.parse({
        votedInElection: { eq: 'No' },
        votedInElectionReportedIds: { in: [ID] },
      }),
    ).toEqual({
      votedInElection: { eq: 'No' },
      votedInElectionReportedIds: { in: [ID] },
    })
  })

  it('rejects a value outside Yes and No', () => {
    expect(() =>
      PeopleFiltersSchema.parse({ votedInElection: { eq: 'Unknown' } }),
    ).toThrow()
  })

  it('rejects an empty or non-uuid reported id set', () => {
    expect(() =>
      PeopleFiltersSchema.parse({ votedInElectionReportedIds: { in: [] } }),
    ).toThrow()
    expect(() =>
      PeopleFiltersSchema.parse({
        votedInElectionReportedIds: { in: ['not-a-uuid'] },
      }),
    ).toThrow()
  })
})
