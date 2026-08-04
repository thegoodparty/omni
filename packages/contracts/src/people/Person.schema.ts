import { z } from 'zod'
import {
  SupportStatusRollupSchema as GeneratedSupportStatusRollupSchema,
  type SupportStatusRollup as GeneratedSupportStatusRollup,
} from '../generated/enums'
import { VoterLikelihoodSchema } from './ContactStatus.schema'

// Support-status rollup vocabulary shown on the person detail response
// (ENG-10696). Sourced from the Prisma `SupportStatusRollup` enum (ENG-10700)
// via `../generated/enums` and re-exported under this historical name so
// existing importers (gp-api's contactInteraction.types.ts, this file's own
// PersonSchema.supportStatus field) don't change. Single-sourced against the
// shipped `SupportAnswer` enum (`supporter | unsure | non_supporter` storage):
// `supporter` and `non_supporter` map 1:1, `unsure` and "no interaction
// history at all" both roll up to `unknown`. gp-api's contactInteraction.types.ts
// ties its SUPPORT_ANSWER_ROLLUP derivation to this schema's inferred type via
// `satisfies`, so the two can't drift.
export const SupportStatusRollupSchema = GeneratedSupportStatusRollupSchema

export type SupportStatusRollup = GeneratedSupportStatusRollup

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

// Door knocking keys at UNIT granularity, not household: an apartment
// building shares one AddressLine, so the household key above would sweep
// every resident of the building into one door (and blow the serve-time
// residents cap). These components resolve to the single knockable unit —
// the July 14 audit's list, in display order. Same normalization recipe.
export const DOOR_KNOCKING_UNIT_KEY_COLUMNS = [
  'Residence_Addresses_HouseNumber',
  'Residence_Addresses_PrefixDirection',
  'Residence_Addresses_StreetName',
  'Residence_Addresses_Designator',
  'Residence_Addresses_SuffixDirection',
  'Residence_Addresses_ApartmentNum',
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
  // Absent (not null) for `eo-` (Serve) organizations: gp-api strips this key
  // before serializing list, detail, and typeahead responses to an elected-
  // office org, per the server-enforced Serve party-visibility rule
  // (ENG-10696). Win responses always carry it.
  politicalParty: z
    .enum(['Independent', 'Democratic', 'Republican', 'Other'])
    .optional(),
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
  // Derived, never stored (SupportStatusService). Only gp-api's person-detail
  // response (`GET /v1/contacts/:id`) attaches this — list/typeahead rows
  // don't carry it in the locked design (ENG-10696).
  supportStatus: SupportStatusRollupSchema.optional(),
  // Derived, never stored (ContactInteractionTextService). Only gp-api's
  // person-detail response (`GET /v1/contacts/:id`) attaches this — same
  // detail-only scope as supportStatus above. ISO timestamp of the most
  // recent `optedOutAt` across the org's ContactInteractionText rows for
  // this person, or null if they've never opted out. A timestamp (not a
  // boolean) so the UI can show recency later without a contract change
  // (ENG-10732).
  optedOutAt: z.string().nullable().optional(),
  // Effective value (manual override ?? seed mapping from `voterStatus`
  // above) — override ownership lives in gp-api's ContactStatusService
  // (ENG-10833). Detail-only, like supportStatus/optedOutAt; omitted for
  // `eo-` (Serve) orgs, which don't get this status at all.
  voterLikelihood: VoterLikelihoodSchema.optional(),
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
