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
export const PHONE_BANKING_MAX_SHEET_COUNT = 20
// The frozen artifact's household grouping: how many entries print per call
// sheet. sheetCount (1-20) x this = the entry cap (max 1,200). Shared by
// gp-api (entry cap + freeze) and the webapp (sheets-step coverage copy).
export const PHONE_BANKING_SHEET_SIZE = 60

// The audience is always a saved VoterFileFilter — the webapp's shared
// outreach audience step (useOutreachAudience) persists a built list via
// POST /v1/voters/voter-file/filter before ever reaching this endpoint,
// mirroring DoorKnockingTurf's saved-filter-only model. There is no inline
// filters variant here (ENG-10931 removed it — the webapp was its only
// caller).
export const PhoneBankingCreateSchema = z
  .object({
    name: z.string().min(1).max(PHONE_BANKING_NAME_MAX_LENGTH),
    script: z.string().min(1).max(PHONE_BANKING_CREATE_SCRIPT_MAX_LENGTH),
    sheetCount: z.number().int().min(1).max(PHONE_BANKING_MAX_SHEET_COUNT),
    voterFileFilterId: z.number().int().positive(),
    purpose: PhoneBankingPurposeSchema,
  })
  .strict()

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
