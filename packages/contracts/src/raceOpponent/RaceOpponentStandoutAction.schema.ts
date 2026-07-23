import { z } from 'zod'

// Haystaq district-sentiment stats attached per card (ENG-10xxx). The counts
// are nullish because a card may carry only the column identity when the
// numeric backing is unavailable; hsColumn is the one required anchor.
export const RaceOpponentStandoutActionHaystaqSchema = z.object({
  hsColumn: z.string().min(1),
  positionPhrase: z.string().min(1).nullish(),
  positionDir: z.enum(['high', 'low']).nullish(),
  totalActive: z.number().int().nonnegative().nullish(),
  voterCountGe50: z.number().int().nonnegative().nullish(),
  voterPercentageGe50: z.number().min(0).max(100).nullish(),
  voterCountGe70: z.number().int().nonnegative().nullish(),
  voterPercentageGe70: z.number().min(0).max(100).nullish(),
})
export type RaceOpponentStandoutActionHaystaq = z.infer<
  typeof RaceOpponentStandoutActionHaystaqSchema
>

// Phase 6 (ENG-10644): stand-out action cards. camelCase mapping of the
// agent's snake_case output (sms_message -> smsMessage, opponent_name ->
// opponentName), same mapping convention as whyTheyreRunning /
// issuesThatMatter in Phase 5.
export const RaceOpponentStandoutActionSchema = z.object({
  title: z.string().min(1).max(99),
  body: z.string().min(1),
  smsMessage: z.string().min(1).max(320),
  // nullish: DB nulls must round-trip, and older payloads may omit it.
  opponentName: z.string().min(1).nullish(),
  issue: z.string().min(1),
  // nullish object, mirroring issuesThatMatter: null for cards without usable
  // district sentiment, absent on legacy payloads.
  haystaq: RaceOpponentStandoutActionHaystaqSchema.nullish(),
})
export type RaceOpponentStandoutAction = z.infer<
  typeof RaceOpponentStandoutActionSchema
>
