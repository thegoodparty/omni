import { z } from 'zod'

export const PHONE_BANKING_PURPOSE_VALUES = [
  'introduce',
  'persuade',
  'event',
  'vote-early',
  'election-day',
  'custom',
] as const
export const PhoneBankingPurposeSchema = z.enum(PHONE_BANKING_PURPOSE_VALUES)
export type PhoneBankingPurpose = z.infer<typeof PhoneBankingPurposeSchema>

export const PHONE_BANKING_NAME_MAX_LENGTH = 60
// Distinct from PHONE_BANKING_SCRIPT_MAX_LENGTH (outreach/PhoneBankingScript
// .schema.ts, 2000) — that one caps an AI-generated draft; this caps the
// user-edited script saved with the audience at create time.
export const PHONE_BANKING_CREATE_SCRIPT_MAX_LENGTH = 5000
export const PHONE_BANKING_FILTER_NAME_MAX_LENGTH = 40
export const PHONE_BANKING_MAX_SHEET_COUNT = 20

// The list builder's audience subset — not the full CRM audience builder
// (gp-api's voterFilterBaseSchema), which lives outside contracts. Sized to
// what the phone-banking inline filter step exposes today; widen here if
// the flow grows more dimensions.
export const PhoneBankingFiltersSchema = z
  .object({
    audienceSuperVoters: z.boolean().optional(),
    audienceLikelyVoters: z.boolean().optional(),
    audienceUnreliableVoters: z.boolean().optional(),
    audienceUnlikelyVoters: z.boolean().optional(),
    audienceUnknown: z.boolean().optional(),
    partyIndependent: z.boolean().optional(),
    partyDemocrat: z.boolean().optional(),
    partyRepublican: z.boolean().optional(),
    partyOther: z.boolean().optional(),
    hasCellPhone: z.boolean().optional(),
    hasLandline: z.boolean().optional(),
    search: z.string().nullish(),
  })
  .strict()
export type PhoneBankingFilters = z.infer<typeof PhoneBankingFiltersSchema>

// Exactly one audience source: a saved filter, or an inline build that
// names and persists a new one (mirrors DoorKnockingTurf's saved-filter-
// only model, extended with the inline path the canvas exposes).
export const PhoneBankingCreateSchema = z
  .object({
    name: z.string().min(1).max(PHONE_BANKING_NAME_MAX_LENGTH),
    script: z.string().min(1).max(PHONE_BANKING_CREATE_SCRIPT_MAX_LENGTH),
    sheetCount: z.number().int().min(1).max(PHONE_BANKING_MAX_SHEET_COUNT),
    voterFileFilterId: z.number().int().positive().optional(),
    filters: PhoneBankingFiltersSchema.optional(),
    filterName: z
      .string()
      .min(1)
      .max(PHONE_BANKING_FILTER_NAME_MAX_LENGTH)
      .optional(),
    purpose: PhoneBankingPurposeSchema,
  })
  .strict()
  .refine(
    (v) => (v.voterFileFilterId === undefined) !== (v.filters === undefined),
    {
      message: 'Provide exactly one of voterFileFilterId or filters',
      path: ['voterFileFilterId'],
    },
  )
  .refine((v) => v.filters === undefined || v.filterName !== undefined, {
    message: 'filterName is required when filters is provided',
    path: ['filterName'],
  })

export type PhoneBankingCreate = z.infer<typeof PhoneBankingCreateSchema>

export const PhoneBankingCreateResponseSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  sheetCount: z.number().int(),
  entryCount: z.number().int(),
  personCount: z.number().int(),
  outreachId: z.number().int().nullable(),
})
export type PhoneBankingCreateResponse = z.infer<
  typeof PhoneBankingCreateResponseSchema
>
