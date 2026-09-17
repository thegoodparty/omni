import { z } from 'zod'
import {
  DoorKnockOutcomeSchema,
  FollowUpAnswerSchema,
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
    // The Serve surface's terminal answer, in place of the two above.
    followUp: FollowUpAnswerSchema.optional(),
    note: z.string().max(2_000).optional(),
  })
  .strict()
  // Only an answered door can yield answers: without this, a payload like
  // {outcome: inaccessible, supportAnswer: supporter} would persist and
  // permanently color the dot as a supporter nobody spoke with
  // (deriveKnockStatus checks supportAnswer before outcome).
  .refine(
    (v) =>
      v.supportAnswer === undefined ||
      v.outcome === DoorKnockOutcomeSchema.enum.answered,
    {
      message: 'supportAnswer is only valid when outcome is answered',
      path: ['supportAnswer'],
    },
  )
  .refine(
    (v) =>
      v.willVote === undefined ||
      v.outcome === DoorKnockOutcomeSchema.enum.answered,
    {
      message: 'willVote is only valid when outcome is answered',
      path: ['willVote'],
    },
  )
  .refine(
    (v) =>
      v.followUp === undefined ||
      v.outcome === DoorKnockOutcomeSchema.enum.answered,
    {
      message: 'followUp is only valid when outcome is answered',
      path: ['followUp'],
    },
  )
  // One surface's vocabulary per row. The two answer sets are alternatives, not
  // additions — a Serve canvasser is never asked about support and a Win
  // canvasser is never asked about follow-up — and a row carrying both would be
  // read as Serve whatever it meant, because `deriveKnockStatus` has to check
  // follow-up first to keep the Win ladder below it unchanged. Refusing the
  // payload is the only way that ambiguity never reaches a status.
  .refine((v) => v.followUp === undefined || v.supportAnswer === undefined, {
    message: 'followUp and supportAnswer belong to different surfaces',
    path: ['followUp'],
  })
  // `willVote` is the other half of the Win ladder and is refused for the same
  // reason, one step further out: it is the only field here that leaves door
  // knocking, as `emitLikelihoodEvent` turns it into a `voter_likelihood`
  // ContactStatusEvent. That write is already `eo-`-gated, so this refine is
  // not what stops the event — it stops the row. A stored `willVote` on a
  // follow-up knock is an answer to a question the canvasser was never shown,
  // and it would read as one to every later reader of the interaction table.
  .refine((v) => v.followUp === undefined || v.willVote === undefined, {
    message: 'followUp and willVote belong to different surfaces',
    path: ['followUp'],
  })

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
