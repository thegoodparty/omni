import type {
  PhoneBankingInteraction,
  PhoneBankingList,
  PhoneBankingListEntry,
  PhoneBankingListPerson,
} from '@goodparty_org/contracts'

// Shared by the row-model tests and the rendered-PDF tests, so both assert
// against the same list rather than two hand-built ones that drift.
export const person = (
  overrides: Partial<PhoneBankingListPerson> = {},
): PhoneBankingListPerson => ({
  personId: 'person-1',
  name: 'Dorian Fen',
  firstName: 'Dorian',
  age: 31,
  party: 'Independent',
  address: '105 Elm St',
  cellPhone: '(312) 555-0101',
  landline: null,
  interaction: null,
  ...overrides,
})

export const interaction = (
  overrides: Partial<PhoneBankingInteraction> = {},
): PhoneBankingInteraction => ({
  outcome: 'answered',
  supportAnswer: null,
  willVote: null,
  occurredAt: new Date('2026-08-18T18:00:00.000Z'),
  ...overrides,
})

export const entry = (
  overrides: Partial<PhoneBankingListEntry> = {},
): PhoneBankingListEntry => ({
  id: 11,
  seq: 1,
  sheetIndex: 1,
  phone: '(312) 555-0101',
  persons: [person()],
  ...overrides,
})

export const list = (
  overrides: Partial<PhoneBankingList> = {},
): PhoneBankingList => ({
  id: 1,
  name: 'Elm & Cedar',
  script: 'Hi, this is a volunteer calling about the election.',
  sheetCount: 1,
  purpose: 'introduce',
  createdAt: new Date('2026-07-21T00:00:00Z'),
  entries: [entry()],
  ...overrides,
})
