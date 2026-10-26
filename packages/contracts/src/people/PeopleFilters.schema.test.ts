import { describe, expect, it } from 'vitest'
import { PeopleFiltersSchema } from './PeopleFilters.schema'

describe('PeopleFiltersSchema earlyAbsenteeVoted', () => {
  it('takes Yes and No', () => {
    expect(
      PeopleFiltersSchema.parse({ earlyAbsenteeVoted: { in: ['Yes', 'No'] } }),
    ).toEqual({ earlyAbsenteeVoted: { in: ['Yes', 'No'] } })
  })

  // No Unknown bucket: a voter missing from the table reads as No.
  it('refuses Unknown', () => {
    expect(
      PeopleFiltersSchema.safeParse({
        earlyAbsenteeVoted: { eq: 'Unknown' },
      }).success,
    ).toBe(false)
  })
})
