import { describe, expect, it } from 'vitest'
import {
  PersonSchema,
  PeopleListResponseSchema,
} from '@goodparty_org/contracts'

const validPerson = {
  id: 'p_123',
  lalVoterId: 'LALNC123456',
  firstName: 'Jane',
  middleName: null,
  lastName: 'Voter',
  nameSuffix: null,
  age: 42,
  state: 'NC',
  address: {
    line1: '123 Main St',
    line2: null,
    city: 'Raleigh',
    state: 'NC',
    zip: '27601',
    zipPlus4: null,
    latitude: '35.7796',
    longitude: '-78.6382',
  },
  cellPhone: '9195550100',
  landline: null,
  gender: 'Female',
  politicalParty: 'Independent',
  registeredVoter: 'Yes',
  estimatedIncomeAmount: 85000,
  voterStatus: 'Likely',
  maritalStatus: 'Married',
  hasChildrenUnder18: 'No',
  veteranStatus: null,
  homeowner: 'Homeowner',
  businessOwner: null,
  levelOfEducation: 'College Degree',
  ethnicityGroup: 'European',
  language: 'English',
}

describe('PersonSchema', () => {
  it('parses a representative people-api person payload', () => {
    expect(PersonSchema.parse(validPerson)).toEqual(validPerson)
  })

  it('rejects a payload missing a required field', () => {
    const { state: _state, ...withoutState } = validPerson
    expect(PersonSchema.safeParse(withoutState).success).toBe(false)
  })

  it('rejects an out-of-range enum value', () => {
    expect(
      PersonSchema.safeParse({ ...validPerson, politicalParty: 'Green' })
        .success,
    ).toBe(false)
  })
})

describe('PeopleListResponseSchema', () => {
  it('parses a paginated people list', () => {
    const payload = {
      pagination: {
        totalResults: 1,
        currentPage: 1,
        pageSize: 25,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      people: [validPerson],
    }
    expect(PeopleListResponseSchema.parse(payload)).toEqual(payload)
  })
})
