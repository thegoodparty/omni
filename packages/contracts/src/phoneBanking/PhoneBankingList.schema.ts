import { z } from 'zod'
import {
  PhoneBankCallOutcomeSchema,
  SupportAnswerSchema,
  WillVoteAnswerSchema,
} from '../generated/enums'
import { zCoerceDate } from '../shared/Date.schema'
import { PhoneBankingPurposeSchema } from './PhoneBankingCreate.schema'

// The saved interaction for one person on the list, or null if nobody has
// logged a call with them yet.
export const PhoneBankingInteractionSchema = z.object({
  outcome: PhoneBankCallOutcomeSchema,
  supportAnswer: SupportAnswerSchema.nullable(),
  willVote: WillVoteAnswerSchema.nullable(),
  occurredAt: zCoerceDate(),
})
export type PhoneBankingInteraction = z.infer<
  typeof PhoneBankingInteractionSchema
>

// Live-enrichment leaves are nullable: a person can vanish from people-db
// between freeze and read (the org-list @ResponseSchema lesson) — gp-api's
// ZodResponseInterceptor 500s the whole response on a schema mismatch.
export const PhoneBankingListPersonSchema = z.object({
  personId: z.string(),
  name: z.string(),
  age: z.number().int().nullable(),
  party: z.string().nullable(),
  address: z.string().nullable(),
  cellPhone: z.string().nullable(),
  landline: z.string().nullable(),
  interaction: PhoneBankingInteractionSchema.nullable(),
})
export type PhoneBankingListPerson = z.infer<
  typeof PhoneBankingListPersonSchema
>

export const PhoneBankingListEntrySchema = z.object({
  id: z.number().int(),
  seq: z.number().int(),
  sheetIndex: z.number().int(),
  phone: z.string(),
  persons: z.array(PhoneBankingListPersonSchema),
})
export type PhoneBankingListEntry = z.infer<typeof PhoneBankingListEntrySchema>

export const PhoneBankingListSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  script: z.string(),
  sheetCount: z.number().int(),
  purpose: PhoneBankingPurposeSchema,
  createdAt: zCoerceDate(),
  entries: z.array(PhoneBankingListEntrySchema),
})
export type PhoneBankingList = z.infer<typeof PhoneBankingListSchema>

// The nativePhoneBanking extension of the outreach detail schema
// (OutreachDetailSchema in outreach/OutreachSocial.schema.ts) — an
// envelope-level rollup, not a per-person read.
export const PhoneBankingOutreachDetailSchema = z.object({
  listId: z.number().int(),
  entriesTotal: z.number().int(),
  entriesCalled: z.number().int(),
  byOutcome: z.record(PhoneBankCallOutcomeSchema, z.number().int()),
  supporters: z.number().int(),
})
export type PhoneBankingOutreachDetail = z.infer<
  typeof PhoneBankingOutreachDetailSchema
>
