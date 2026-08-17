import type { PeopleFilters } from '@goodparty_org/contracts'

export type FilterVariant = { name: string; payload: PeopleFilters }

export const FILTER_VARIANTS: readonly FilterVariant[] = [
  { name: 'none', payload: {} },
  // Doubles as the sms/polls tile of the list-detail reachability grid —
  // ContactsService.fetchListDetailAggregates fans out to three
  // channel-restricted getAggregates calls, and this is the first of them.
  { name: 'single-boolean', payload: { hasCellPhone: true } },
  {
    name: 'single-multivalue',
    payload: { politicalParty: { in: ['Democratic', 'Republican'] } },
  },
  {
    name: 'broad-lowselectivity',
    payload: { gender: { is: 'not_null' }, educationLevel: { is: 'not_null' } },
  },
  {
    name: 'narrow-highselectivity',
    payload: {
      hasCellPhone: true,
      hasLandline: false,
      voterStatus: { in: ['Super', 'Likely'] },
      politicalParty: { eq: 'Democratic' },
      maritalStatus: { eq: 'Married' },
      veteranStatus: { eq: 'Yes' },
      educationLevel: { eq: 'College Degree' },
      ethnicity: { eq: 'Hispanic' },
      businessOwner: { eq: 'Yes' },
      presenceOfChildren: { in: ['Yes', 'No'] },
      homeowner: { in: ['Yes', 'Likely'] },
      gender: { in: ['M', 'F'] },
      language: { in: ['English', 'Spanish'] },
      estimatedIncomeAmountInt: { gte: 25000, lte: 75000 },
      ageInt: { gte: 18, lte: 65 },
    },
  },
  {
    name: 'numeric-range',
    payload: {
      ageInt: { gte: 18, lte: 65 },
      estimatedIncomeAmountInt: { gte: 25000, lte: 75000 },
    },
  },
  // The other two channel tiles. Same membership scan as the base aggregate
  // plus one has-contact-method predicate, so they measure whether the extra
  // predicate changes the plan on the join path.
  { name: 'channel-landline', payload: { hasLandline: true } },
  { name: 'channel-address', payload: { hasAddress: true } },
]
