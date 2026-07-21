import { z } from 'zod'
import {
  DoorKnockOutcomeSchema,
  SupportAnswerSchema,
  WillVoteAnswerSchema,
} from '../generated/enums'
import { DoorKnockStatusSchema } from './DoorKnockingRoutePayload.schema'

// Recording a knock: the phone sends only the frozen stopTargetId, its
// answers, and a client-minted key — personId resolves from the stop target
// server-side, organizationSlug comes from auth, and occurredAt is
// server-stamped. clientKey is the replay-idempotency key (dead-zone
// retries): the same key upserts the same row, never a duplicate.
export const RecordDoorKnockInteractionSchema = z
  .object({
    stopTargetId: z.number().int().positive(),
    clientKey: z.guid(),
    outcome: DoorKnockOutcomeSchema,
    supportAnswer: SupportAnswerSchema.optional(),
    willVote: WillVoteAnswerSchema.optional(),
    note: z.string().max(2_000).optional(),
  })
  .strict()

export type RecordDoorKnockInteraction = z.infer<
  typeof RecordDoorKnockInteractionSchema
>

// The derived status comes back so the walk view recolors the dot without
// re-fetching the route.
export const RecordDoorKnockInteractionResponseSchema = z.object({
  personId: z.string(),
  knockStatus: DoorKnockStatusSchema,
})

export type RecordDoorKnockInteractionResponse = z.infer<
  typeof RecordDoorKnockInteractionResponseSchema
>
