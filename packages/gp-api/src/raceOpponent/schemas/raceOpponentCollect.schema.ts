import { z } from 'zod'
import { RaceOpponentCollectionStatusSchema } from '@goodparty_org/contracts'

export const RaceOpponentCollectResponseSchema = z.object({
  runId: z.string(),
  // 'running' for both a freshly dispatched run and an already-in-flight one
  // that this call reused instead of dispatching a duplicate.
  status: RaceOpponentCollectionStatusSchema,
})
export type RaceOpponentCollectResponse = z.infer<
  typeof RaceOpponentCollectResponseSchema
>
