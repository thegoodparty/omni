import { z } from 'zod'
import {
  PhoneBankCallOutcomeSchema,
  SupportAnswerSchema,
  WillVoteAnswerSchema,
} from '../generated/enums'
import { PhoneBankingInteractionSchema } from './PhoneBankingList.schema'

export const PHONE_BANKING_CALL_NOTE_MAX_LENGTH = 2_000

// Logging a call: entryId identifies the dialed number, personId (when
// present) is who picked up — server validates it against the entry's
// persons. supportAnswer/willVote only carry meaning for an answered call
// that reached the named person. `refused` WITH personId is "answered but
// refused to engage" and logs on that person alone; a number-level outcome
// (no_answer, voicemail, wrong_number, refused with no personId) fans out
// to every person on the entry server-side.
export const RecordPhoneBankingCallSchema = z
  .object({
    entryId: z.number().int().positive(),
    outcome: PhoneBankCallOutcomeSchema,
    personId: z.string().optional(),
    supportAnswer: SupportAnswerSchema.optional(),
    willVote: WillVoteAnswerSchema.optional(),
    note: z.string().max(PHONE_BANKING_CALL_NOTE_MAX_LENGTH).optional(),
    // After an answered upsert, log the entry's remaining un-logged
    // household members as answered too, in the same request.
    markHouseholdDone: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.personId === undefined ||
      v.outcome === PhoneBankCallOutcomeSchema.enum.answered ||
      v.outcome === PhoneBankCallOutcomeSchema.enum.refused,
    {
      message: 'personId is only valid when outcome is answered or refused',
      path: ['personId'],
    },
  )
  .refine(
    (v) =>
      v.outcome !== PhoneBankCallOutcomeSchema.enum.answered ||
      v.personId !== undefined,
    {
      message: 'personId is required when outcome is answered',
      path: ['personId'],
    },
  )
  .refine(
    (v) =>
      v.supportAnswer === undefined ||
      v.outcome === PhoneBankCallOutcomeSchema.enum.answered,
    {
      message: 'supportAnswer is only valid when outcome is answered',
      path: ['supportAnswer'],
    },
  )
  .refine(
    (v) =>
      v.willVote === undefined ||
      v.outcome === PhoneBankCallOutcomeSchema.enum.answered,
    {
      message: 'willVote is only valid when outcome is answered',
      path: ['willVote'],
    },
  )
  .refine(
    (v) =>
      !v.markHouseholdDone ||
      v.outcome === PhoneBankCallOutcomeSchema.enum.answered,
    {
      message: 'markHouseholdDone is only valid when outcome is answered',
      path: ['markHouseholdDone'],
    },
  )

export type RecordPhoneBankingCall = z.infer<
  typeof RecordPhoneBankingCallSchema
>

// The response reads from the persisted rows, never the request body, so a
// retry always reports real state. `results` covers the selected person and
// the full number-level fan-out; for markHouseholdDone it's every household
// member's current row, including ones already logged before this call, not
// just the ones this call inserted.
export const PhoneBankingCallResultSchema = z.object({
  personId: z.string(),
  interaction: PhoneBankingInteractionSchema,
})
export type PhoneBankingCallResult = z.infer<
  typeof PhoneBankingCallResultSchema
>

export const RecordPhoneBankingCallResponseSchema = z.object({
  entryId: z.number().int(),
  results: z.array(PhoneBankingCallResultSchema),
  envelopeCompleted: z.boolean(),
})
export type RecordPhoneBankingCallResponse = z.infer<
  typeof RecordPhoneBankingCallResponseSchema
>
