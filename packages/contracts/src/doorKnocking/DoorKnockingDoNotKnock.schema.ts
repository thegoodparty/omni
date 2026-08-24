import { z } from 'zod'
import { DoNotKnockStatusSchema } from '../people/ContactStatus.schema'

// ADR 0007. Separate from RecordDoorKnockInteractionSchema on purpose: that
// payload requires an outcome and gates its answers on `answered`, while a
// do-not-knock is recordable when there is nothing to log — a neighbor
// mentions hospice, a sign in the window — and has to be reversible on its
// own.
//
// Takes a stopTargetId rather than a personId so authorization is the same
// ownership check the interaction write already makes: the target has to sit
// on a route in the caller's org. No clientKey — ContactStatusService no-ops
// when the value is unchanged, so a double-tap is free, and a genuine reversal
// deserves its own row in the log rather than being deduped away.
export const SetDoNotKnockSchema = z
  .object({
    stopTargetId: z.number().int().positive(),
    value: DoNotKnockStatusSchema,
  })
  .strict()

export type SetDoNotKnock = z.infer<typeof SetDoNotKnockSchema>

// Echoes the persisted state so the walk view reflects the row rather than the
// tap, and returns personId for the same reason the interaction response does:
// the caller holds stop targets, the CRM speaks in people.
export const SetDoNotKnockResponseSchema = z.object({
  personId: z.string(),
  doNotKnock: z.boolean(),
})

export type SetDoNotKnockResponse = z.infer<typeof SetDoNotKnockResponseSchema>
