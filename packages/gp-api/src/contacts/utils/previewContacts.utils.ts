import type { Person, PeopleListResponse } from '@goodparty_org/contracts'

// Synthetic voter rows for the non-pro upsell preview (ENG-10508). Our data
// contracts forbid sending real voter PII to a non-pro user, and a frontend
// blur is not a real boundary — the blurred values are copy-pastable straight
// out of the DOM. So the base list returns fabricated people the UI still
// blurs: a copied value can never belong to a real person. Phone numbers use
// the 555-01xx range reserved for fictional use as a second guard. Rows are
// deterministic (varied by index) so tests can assert on them.

const FIRST_NAMES = [
  'Alex',
  'Jordan',
  'Taylor',
  'Morgan',
  'Casey',
  'Riley',
  'Jamie',
  'Quinn',
  'Avery',
  'Drew',
]
const LAST_NAMES = [
  'Rivera',
  'Bennett',
  'Coleman',
  'Hayes',
  'Powell',
  'Sanders',
  'Mitchell',
  'Foster',
  'Reed',
  'Barnes',
]
const STREETS = [
  'Main St',
  'Oak Ave',
  'Maple Dr',
  'Cedar Ln',
  'Elm St',
  'Park Blvd',
]
const CITIES = ['Springfield', 'Riverside', 'Fairview', 'Greenville']
const PREVIEW_STATE = 'CA'
const PARTIES: Person['politicalParty'][] = [
  'Independent',
  'Democratic',
  'Republican',
  'Other',
]
const GENDERS: NonNullable<Person['gender']>[] = ['Male', 'Female']

const pick = <T>(list: readonly T[], index: number): T =>
  list[index % list.length]

const buildPreviewPerson = (index: number): Person => {
  const houseNumber = 100 + index * 7
  const phoneSuffix = String(index % 100).padStart(2, '0')
  return {
    id: `preview-${index}`,
    lalVoterId: `preview-${index}`,
    firstName: pick(FIRST_NAMES, index),
    middleName: null,
    lastName: pick(LAST_NAMES, index + 3),
    nameSuffix: null,
    age: 25 + (index % 50),
    state: PREVIEW_STATE,
    address: {
      line1: `${houseNumber} ${pick(STREETS, index)}`,
      line2: null,
      city: pick(CITIES, index),
      state: PREVIEW_STATE,
      zip: String(90000 + (index % 1000)).padStart(5, '0'),
      zipPlus4: null,
      latitude: null,
      longitude: null,
    },
    cellPhone: `(202) 555-01${phoneSuffix}`,
    landline: `(202) 555-01${String((index + 50) % 100).padStart(2, '0')}`,
    gender: pick(GENDERS, index),
    politicalParty: pick(PARTIES, index),
    registeredVoter: 'Yes',
    estimatedIncomeAmount: null,
    voterStatus: null,
    maritalStatus: null,
    hasChildrenUnder18: null,
    veteranStatus: null,
    homeowner: null,
    businessOwner: null,
    levelOfEducation: null,
    ethnicityGroup: null,
    language: 'English',
  }
}

// Single-page synthetic preview: the upsell teaser shows one page of blurred
// fake rows and no pagination, so a non-pro user can't page through to imply a
// real dataset exists behind it.
export const buildPreviewContacts = (count: number): PeopleListResponse => {
  const safeCount = Math.max(0, count)
  const people = Array.from({ length: safeCount }, (_, index) =>
    buildPreviewPerson(index),
  )
  return {
    pagination: {
      totalResults: people.length,
      currentPage: 1,
      pageSize: safeCount,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    people,
  }
}
