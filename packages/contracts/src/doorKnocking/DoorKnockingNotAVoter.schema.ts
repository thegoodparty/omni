import { z } from 'zod'
import {
  NotAVoterReasonSchema,
  NotAVoterStatusSchema,
} from '../people/ContactStatus.schema'

// ADR 0008. The answer to "What happened?", asked after a `not_a_voter`
// outcome. Its own request rather than a field on RecordDoorKnockInteraction
// for two reasons: that payload is replay-idempotent on clientKey, so a
// correction made on a later visit could not reach the row it needs to change;
// and the reason has to be reversible on its own, which an interaction record
// has no vocabulary for.
//
// Takes a stopTargetId, like the do-not-knock write, so authorization is the
// same ownership check — the target must sit on a route in the caller's org.
export const SetNotAVoterSchema = z
  .object({
    stopTargetId: z.number().int().positive(),
    value: NotAVoterStatusSchema,
  })
  .strict()

export type SetNotAVoter = z.infer<typeof SetNotAVoterSchema>

// Echoes the persisted reason rather than the tap. `cleared` comes back as an
// absent key, matching how the route payload marks the same person: the caller
// renders a marker iff a reason is present, and never has to know that the
// storage spells "no reason" as a value.
export const SetNotAVoterResponseSchema = z.object({
  personId: z.string(),
  notAVoterReason: NotAVoterReasonSchema.optional(),
})

export type SetNotAVoterResponse = z.infer<typeof SetNotAVoterResponseSchema>
