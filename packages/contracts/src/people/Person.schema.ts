import { z } from 'zod'

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
