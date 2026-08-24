import type { PeopleFilters } from '@goodparty_org/contracts'

// The three ways gp-api turns a prior-outreach selection into SQL. Resolved
// from contact_interaction_* row counts by ContactsMadeResolutionService, so
// the harness has to materialize a real id set per cohort before it can run
// these — see sampleIds in harness.ts.
export type IdSetShape = 'in' | 'notIn' | 'overrideMixed'

// One prior-outreach id set per cohort, reused by all three outreach variants
// so the only thing differing between them is the SQL shape. 5k is the order
// of magnitude a real campaign's contacted set reaches; the hard cap is
// MAX_RESOLVED_ID_SET_SIZE (100k).
export const ID_SET_SIZE = 5000
// Fixed so the same ids come back every run: a delta between two passes has to
// be a real regression, not a different sample. Hash-ordering also scatters
// them across the partition the way an outreach list does, rather than handing
// the planner a run of neighbours in index order.
export const ID_SAMPLE_SEED = 'people-db-bench-v1'

export type FilterVariant = {
  name: string
  description: string
  payload: PeopleFilters
  idSet?: IdSetShape
}

export const FILTER_VARIANTS: readonly FilterVariant[] = [
  {
    name: 'none',
    description:
      'No filter at all: the whole district. This is the universe row the ' +
      'contacts sheet opens on, and the only shape that has to aggregate ' +
      'every member.',
    payload: {},
  },
  // Doubles as the sms/polls tile of the list-detail reachability grid —
  // ContactsService.fetchListDetailAggregates fans out to three
  // channel-restricted getAggregates calls, and this is the first of them.
  {
    name: 'single-boolean',
    description:
      'One yes/no flag (has a cell phone). Also the sms/polls tile of the ' +
      'list-detail reachability grid.',
    payload: { hasCellPhone: true },
  },
  {
    name: 'single-multivalue',
    description:
      'One field matched against a short list of allowed values (party is ' +
      'Democratic or Republican). The most common real saved-list shape.',
    payload: {
      politicalParty: { in: ['Democratic', 'Republican'] },
    },
  },
  {
    name: 'broad-lowselectivity',
    description:
      'A filter that keeps MOST of the district (gender and education both ' +
      'present). Low selectivity means the query still has to aggregate ' +
      'nearly everyone, so it costs about as much as no filter.',
    payload: { gender: { is: 'not_null' }, educationLevel: { is: 'not_null' } },
  },
  {
    name: 'narrow-highselectivity',
    description:
      'Fifteen conditions at once, keeping VERY few people. High ' +
      'selectivity lets the planner drive off an index and skip most of the ' +
      'state partition, which is why it is usually the fastest cell in a row.',
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
    description:
      'Two between-X-and-Y numeric ranges (age 18 to 65 and an income ' +
      'band). Ranges cannot use an equality index the way a single value can.',
    payload: {
      ageInt: { gte: 18, lte: 65 },
      estimatedIncomeAmountInt: { gte: 25000, lte: 75000 },
    },
  },
  // The other two channel tiles. Same membership scan as the base aggregate
  // plus one has-contact-method predicate, so they measure whether the extra
  // predicate changes the plan on the join path.
  {
    name: 'channel-landline',
    description:
      'Has a landline. The phone-banking tile of the list-detail ' +
      'reachability grid.',
    payload: { hasLandline: true },
  },
  {
    name: 'channel-address',
    description:
      'Has a mailing address. The door-knocking tile of the list-detail ' +
      'reachability grid.',
    payload: { hasAddress: true },
  },
  {
    name: 'outreach-include',
    description:
      'Only people who were part of a previous outreach: an id inclusion ' +
      'list bound as one array parameter (v.id = ANY). This is how a ' +
      '"prior contacts made" selection that leaves out the 0 bucket ' +
      'reaches SQL.',
    payload: {},
    idSet: 'in',
  },
  {
    name: 'outreach-exclude',
    description:
      'Everyone EXCEPT the people already contacted: an id exclusion list ' +
      '(v.id != ALL). This is the "never contacted" selection — the set of ' +
      'people with no interactions cannot be enumerated directly, so it ' +
      'travels as notIn over everyone who has one.',
    payload: {},
    idSet: 'notIn',
  },
  {
    name: 'outreach-mixed',
    description:
      'The mixed "never contacted, plus one specific contact bucket" ' +
      'selection. Bucket ids are a subset of the contacted set, so it ' +
      'cannot collapse to a single in/notIn operator: it travels as ' +
      'contactsMadeIdOverrides and AND-composes an OR at the top level.',
    payload: {},
    idSet: 'overrideMixed',
  },
]
