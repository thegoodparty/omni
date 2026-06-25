import { z } from 'zod'

// Residence-address columns (Voter table) that compose a physical-household
// key for door-knocking de-duplication. Chosen as the canvassing-correct key
// (where a door-knocker physically stands), NOT Mailing_Families_FamilyID
// (which keys mailing households). people-api builds the grouping key by
// UPPER(TRIM(COALESCE(col,''))) over exactly these columns in this order;
// gp-api forwards `groupByHousehold` to opt in. Living here keeps the producer
// (people-api) and the contract in lockstep so the key definition can't drift.
export const HOUSEHOLD_KEY_RESIDENCE_COLUMNS = [
  'Residence_Addresses_AddressLine',
  'Residence_Addresses_City',
  'Residence_Addresses_State',
  'Residence_Addresses_Zip',
] as const

// Shared person/voter shape sourced from people-api, surfaced through gp-api's
// /v1/contacts and consumed by gp-webapp. Field names and nullability mirror
// people-api's PersonOutput exactly — keep them in lockstep to avoid drift.
export const PersonSchema = z.object({
  id: z.string(),
  lalVoterId: z.string(),
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  nameSuffix: z.string().nullable(),
  age: z.number().nullable(),
  state: z.string(),
  address: z.object({
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    zip: z.string().nullable(),
    zipPlus4: z.string().nullable(),
    latitude: z.string().nullable(),
    longitude: z.string().nullable(),
  }),
  cellPhone: z.string().nullable(),
  landline: z.string().nullable(),
  gender: z.enum(['Male', 'Female']).nullable(),
  politicalParty: z.enum([
    'Independent',
    'Democratic',
    'Republican',
    'Other',
  ]),
  registeredVoter: z.enum(['Yes', 'No']),
  estimatedIncomeAmount: z.number().nullable(),
  voterStatus: z
    .enum(['Super', 'Likely', 'Unreliable', 'Unlikely', 'First Time'])
    .nullable(),
  maritalStatus: z
    .enum(['Likely Married', 'Likely Single', 'Married', 'Single'])
    .nullable(),
  hasChildrenUnder18: z.enum(['Yes', 'No']).nullable(),
  veteranStatus: z.enum(['Yes']).nullable(),
  homeowner: z.enum(['Yes', 'Likely', 'No']).nullable(),
  businessOwner: z.enum(['Yes']).nullable(),
  levelOfEducation: z
    .enum([
      'None',
      'High School Diploma',
      'Technical School',
      'Some College',
      'College Degree',
      'Graduate Degree',
    ])
    .nullable(),
  ethnicityGroup: z
    .enum(['Asian', 'European', 'Hispanic', 'African American', 'Other'])
    .nullable(),
  language: z.enum(['English', 'Spanish', 'Other']),
  // Populated only when people-api runs in household-grouped mode (door
  // knocking). `householdId` is a normalized residence-address composite (see
  // HOUSEHOLD_KEY_RESIDENCE_COLUMNS) shared by every voter at the same physical
  // address; `householdSize` is how many of the voters MATCHING the current
  // segment/filters share that address (filter-scoped, not raw occupancy — a
  // hasCellPhone segment counts only the matching contacts at the address).
  // null on the ungrouped (one-row-per-voter) path.
  householdId: z.string().nullable().optional(),
  householdSize: z.number().int().nullable().optional(),
})

export type Person = z.infer<typeof PersonSchema>

// Response-side pagination metadata returned alongside a people list. Distinct
// from the request-side PaginationSchema in shared/Pagination.schema.ts (which
// carries offset/limit/sortOrder), so it lives here rather than reusing that.
export const PeopleListPaginationSchema = z.object({
  totalResults: z.number(),
  currentPage: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
})

export type PeopleListPagination = z.infer<typeof PeopleListPaginationSchema>

export const PeopleListResponseSchema = z.object({
  pagination: PeopleListPaginationSchema,
  people: z.array(PersonSchema),
})

export type PeopleListResponse = z.infer<typeof PeopleListResponseSchema>
