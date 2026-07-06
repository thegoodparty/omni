import { z } from 'zod'

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
})
export type RaceOpponentStandoutAction = z.infer<
  typeof RaceOpponentStandoutActionSchema
>
