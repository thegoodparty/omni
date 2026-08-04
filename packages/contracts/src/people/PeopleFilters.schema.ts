import { z } from 'zod'

/**
 * The people-api `filters` input grammar (POST /v1/people and the
 * door-knocking evaluation), lifted here so the producer (gp-api's
 * voter-file-filter translation) and the consumer (people-api's Zod DTOs)
 * validate against one definition. people-api keeps its server-side
 * transform (`transformFilters`) — this file owns only the wire shape.
 *
 * Example JSON structure:
 * {
 *   "hasCellPhone": true,                          // Boolean filter (true = IS NOT NULL)
 *   "hasAddress": true,                            // Boolean filter (true = IS NOT NULL)
 *   "id": { "in": ["<uuid>"] },                    // Id filter with 'in' operator
 *   "id": { "notIn": ["<uuid>"] },                 // Id filter with 'notIn' operator
 *   "voterStatus": { "in": ["Super", "Likely"] }, // Enum filter with 'in' operator
 *   "politicalParty": { "eq": "Democratic" }, // Enum filter with 'eq' operator
 *   "maritalStatus": { "is": "not_null" },        // Enum filter with 'is' operator
 *   "gender": { "in": ["M", "F"] },               // Enum filter with multiple values
 *   "language": { "in": ["English", "Spanish"] }, // Enum filter with 'in' operator
 *   "estimatedIncomeAmountInt": { "gte": 25000, "lte": 50000 }, // Numeric filter with range
 *   "estimatedIncomeAmountInt": { "in": [25000, 50000, 75000] }, // Numeric filter with 'in' operator
 *   "estimatedIncomeAmountInt": { "_or": [{ "gte": 0, "lte": 25000 }, { "gte": 75000, "lte": 100000 }] }, // Numeric filter with OR'd ranges
 *   "estimatedIncomeAmountInt": { "gte": 25000, "_includeNull": true }, // Numeric filter including null values
 *   "ageInt": { "gte": 18, "lte": 65 },            // Numeric filter with range
 *   "ageInt": { "in": [25, 30, 35] },             // Numeric filter with 'in' operator
 *   "ageInt": { "eq": 30 }                         // Numeric filter with 'eq' operator
 * }
 *
 * Filter Types:
 * - Boolean filters: hasCellPhone, hasLandline, hasAddress (true = IS NOT NULL, false = IS NULL)
 * - Id filter: id — Operators: { in: string[] }, { notIn: string[] } (exactly one, each 1-100000 uuids)
 * - Enum filters: voterStatus, politicalParty, maritalStatus, veteranStatus, educationLevel,
 *   ethnicity, businessOwner, presenceOfChildren, homeowner, gender, language
 *   Operators: { in: string[] }, { eq: string }, { is: "not_null" | "null" }
 * - Numeric filters: ageInt, estimatedIncomeAmountInt
 *   Operators: { in: number[] }, { eq: number }, { gte: number }, { lte: number }, { is: "not_null" | "null" }
 *   Options: { _or: [{ gte, lte }] } for OR'd ranges, { _includeNull: boolean } to include null values in results
 */
export type IncomeRange = { min: number; max: number | null }

// The saved-filter incomeRanges vocabulary and the numeric bounds each key
// translates to. Cross-service: gp-api's boolean→filter translation emits
// these bounds, and people-api's pack encoder buckets incomes by them.
export const INCOME_RANGE_MAPPING: Record<string, IncomeRange> = {
  'Under $25k': { min: 0, max: 24999 },
  '$25k - $35k': { min: 25000, max: 34999 },
  '$35k - $50k': { min: 35000, max: 49999 },
  '$50k - $75k': { min: 50000, max: 74999 },
  '$75k - $100k': { min: 75000, max: 99999 },
  '$100k - $125k': { min: 100000, max: 124999 },
  '$125k - $150k': { min: 125000, max: 149999 },
  '$150k - $200k': { min: 150000, max: 199999 },
  '$200k+': { min: 200000, max: null },
}

export const PEOPLE_FILTER_VALUE_ENUMS = {
  voterStatus: [
    'Super',
    'Likely',
    'Unreliable',
    'Unlikely',
    'First Time',
    'Unknown',
  ] as const,
  politicalParty: ['Independent', 'Democratic', 'Republican', 'Other'] as const,
  maritalStatus: [
    'Inferred Married',
    'Inferred Single',
    'Married',
    'Single',
    'Unknown',
  ] as const,
  veteranStatus: ['Yes', 'Unknown'] as const,
  educationLevel: [
    'None',
    'High School Diploma',
    'Technical School',
    'Some College',
    'College Degree',
    'Graduate Degree',
    'Unknown',
  ] as const,
  ethnicity: [
    'Asian',
    'European',
    'Hispanic',
    'African American',
    'Other',
    'Unknown',
  ] as const,
  businessOwner: ['Yes', 'Unknown'] as const,
  presenceOfChildren: ['Yes', 'No', 'Unknown'] as const,
  homeowner: ['Yes', 'Likely', 'No', 'Unknown'] as const,
  gender: ['M', 'F', 'Unknown'] as const,
  language: ['English', 'Spanish', 'Other'] as const,
} as const

export const createEnumFilterSchema = <T extends readonly string[]>(
  allowedValues: T,
) => {
  return z
    .object({
      in: z
        .array(z.enum(allowedValues as unknown as [string, ...string[]]))
        .min(1)
        .optional(),
      eq: z.enum(allowedValues as unknown as [string, ...string[]]).optional(),
      is: z.enum(['not_null', 'null']).optional(),
    })
    .refine((data) => {
      const operatorCount = [data.in, data.eq, data.is].filter(Boolean).length
      return operatorCount === 1
    }, 'Exactly one operator (in, eq, or is) must be specified')
}

const rangeConditionSchema = z
  .object({
    gte: z.coerce.number().optional(),
    lte: z.coerce.number().optional(),
  })
  .refine(
    (data) => data.gte !== undefined || data.lte !== undefined,
    'At least one of gte or lte must be specified in each _or range',
  )

// The id filter takes an id set (in/notIn), not eq/is, and caps the array —
// id sets can arrive from arbitrarily large upstream resolutions. 100k is
// safe only because people-api's buildIdFilter binds the set as a single
// array parameter; per-value binding would hit PostgreSQL's 65,535
// bind-parameter limit.
const MAX_ID_FILTER_VALUES = 100_000

export const createIdFilterSchema = () => {
  return z
    .object({
      in: z.array(z.guid()).min(1).max(MAX_ID_FILTER_VALUES).optional(),
      notIn: z.array(z.guid()).min(1).max(MAX_ID_FILTER_VALUES).optional(),
    })
    .refine((data) => {
      const operatorCount = [data.in, data.notIn].filter(Boolean).length
      return operatorCount === 1
    }, 'Exactly one operator (in or notIn) must be specified')
}

// Override-aware Voter Likelihood filtering (ENG-10838): a top-level sibling
// of `filters` (not a `PeopleFilters` field) on the list/download/aggregates/
// overlap-count request shapes. gp-api resolves `include`/`exclude` person-id
// sets from ContactStatusService overrides; people-api composes them as an OR
// scoped to ONLY the voterStatus clause — never the whole filter conjunction,
// so an override-included person still respects every other selected filter.
// Reuses the id-filter's 100k cap and single-array-param bind rationale.
export const IdOverridesSchema = z.object({
  include: z.array(z.guid()).min(1).max(MAX_ID_FILTER_VALUES).optional(),
  exclude: z.array(z.guid()).min(1).max(MAX_ID_FILTER_VALUES).optional(),
})
export type IdOverrides = z.infer<typeof IdOverridesSchema>

export const createNumericFilterSchema = () => {
  return z
    .object({
      in: z.array(z.coerce.number()).min(1).optional(),
      eq: z.coerce.number().optional(),
      gte: z.coerce.number().optional(),
      lte: z.coerce.number().optional(),
      is: z.enum(['not_null', 'null']).optional(),
      // min(1): an empty _or would pass the operator-count refine below,
      // then be silently dropped by the SQL builder — the field would go
      // unfiltered instead of erroring.
      _or: z.array(rangeConditionSchema).min(1).optional(),
      _includeNull: z.boolean().optional(),
    })
    .refine((data) => {
      const operatorCount = [
        data.in,
        data.eq,
        data.gte,
        data.lte,
        data.is,
        data._or,
      ].filter((value) => value !== undefined).length
      return operatorCount >= 1
    }, 'At least one operator must be specified')
}

// Deliberately NOT .strict(): gp-api's boolean→filter translation can emit
// keys outside this vocabulary (its generic fall-through loop), and
// people-api's contract has always been to strip unknown keys, not 400.
export const PeopleFiltersSchema = z.object({
  hasCellPhone: z.boolean().optional(),
  hasLandline: z.boolean().optional(),
  hasAddress: z.boolean().optional(),
  id: createIdFilterSchema().optional(),
  maritalStatus: createEnumFilterSchema(
    PEOPLE_FILTER_VALUE_ENUMS.maritalStatus,
  ).optional(),
  veteranStatus: createEnumFilterSchema(
    PEOPLE_FILTER_VALUE_ENUMS.veteranStatus,
  ).optional(),
  educationLevel: createEnumFilterSchema(
    PEOPLE_FILTER_VALUE_ENUMS.educationLevel,
  ).optional(),
  ethnicity: createEnumFilterSchema(
    PEOPLE_FILTER_VALUE_ENUMS.ethnicity,
  ).optional(),
  businessOwner: createEnumFilterSchema(
    PEOPLE_FILTER_VALUE_ENUMS.businessOwner,
  ).optional(),
  presenceOfChildren: createEnumFilterSchema(
    PEOPLE_FILTER_VALUE_ENUMS.presenceOfChildren,
  ).optional(),
  homeowner: createEnumFilterSchema(
    PEOPLE_FILTER_VALUE_ENUMS.homeowner,
  ).optional(),
  gender: createEnumFilterSchema(PEOPLE_FILTER_VALUE_ENUMS.gender).optional(),
  voterStatus: createEnumFilterSchema(
    PEOPLE_FILTER_VALUE_ENUMS.voterStatus,
  ).optional(),
  politicalParty: createEnumFilterSchema(
    PEOPLE_FILTER_VALUE_ENUMS.politicalParty,
  ).optional(),
  language: createEnumFilterSchema(
    PEOPLE_FILTER_VALUE_ENUMS.language,
  ).optional(),
  estimatedIncomeAmountInt: createNumericFilterSchema().optional(),
  ageInt: createNumericFilterSchema().optional(),
})

export type PeopleFilters = z.infer<typeof PeopleFiltersSchema>
