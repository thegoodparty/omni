import { z } from 'zod'
import { RaceOpponentCollectionStatusSchema } from '@goodparty_org/contracts'

export const RaceOpponentCollectResponseSchema = z.object({
  // The dispatched run's id: the race_opponent_collection run when collecting,
  // or the opposition_research run when discovering. Null when the call settled
  // without dispatching (uncontested race, or discovery unavailable).
  runId: z.string().nullable(),
  // 'running' for a freshly dispatched or reused-in-flight collection run;
  // 'discovering' while opposition_research identifies opponents first; 'idle'
  // when settled with nothing to do.
  status: RaceOpponentCollectionStatusSchema,
})
export type RaceOpponentCollectResponse = z.infer<
  typeof RaceOpponentCollectResponseSchema
>
