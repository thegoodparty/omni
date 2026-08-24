import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { zDate } from '@goodparty_org/contracts'

// Who performed the takedown, supplied by the caller rather than inferred.
// gp-admin reaches gp-api over a shared M2M token, so the request carries no
// operator identity for the server to read — an unattributed takedown would be
// unattributable forever. Deliberately free-form so both kinds of caller fit:
// an email address for a human ("ops@goodparty.org"), or `system:<name>` for
// automation.
const ActorSchema = z.string().min(1, 'actor is required').max(200)

// Admin/ops payload to flag (or clear) a person's public profile for privacy
// removal. personId is the canonical civics Person (gp_candidate_id). note is a
// free-text ops record of what/why was requested.
const SetPersonProfileRemovalSchema = z
  .object({
    personId: z.guid('personId must be a valid UUID'),
    appliedBy: ActorSchema,
    note: z.string().max(2000).nullable().optional(),
  })
  .strict()

export class SetPersonProfileRemovalDto extends createZodDto(
  SetPersonProfileRemovalSchema,
) {}

export type SetPersonProfileRemovalInput = z.infer<
  typeof SetPersonProfileRemovalSchema
>

const ClearPersonProfileRemovalSchema = z
  .object({
    personId: z.guid('personId must be a valid UUID'),
    clearedBy: ActorSchema,
  })
  .strict()

export class ClearPersonProfileRemovalDto extends createZodDto(
  ClearPersonProfileRemovalSchema,
) {}

export const PersonProfileRemovalResponseSchema = z.object({
  personId: z.string(),
  removed: z.literal(true),
  requestedAt: zDate(),
})

export type PersonProfileRemovalResponse = z.infer<
  typeof PersonProfileRemovalResponseSchema
>

// Admin-only view of the takedown log. This is the one removal shape that
// carries the ops note and the actor, so it is only ever returned from a route
// behind AdminOrM2MGuard — the public /unlisted feed deliberately exposes
// personId and nothing else.
export const PersonProfileRemovalListSchema = z.array(
  z.object({
    personId: z.string(),
    note: z.string().nullable(),
    requestedAt: zDate(),
    appliedBy: z.string(),
    // Null on an active takedown; set once it has been reverted.
    clearedAt: zDate().nullable(),
    clearedBy: z.string().nullable(),
  }),
)

export type PersonProfileRemovalList = z.infer<
  typeof PersonProfileRemovalListSchema
>

// Query flag for the admin list. Cleared rows are history rather than a working
// queue, so the default view is active takedowns only.
const ListPersonProfileRemovalsSchema = z
  .object({
    includeCleared: z.stringbool().optional(),
  })
  .strict()

export class ListPersonProfileRemovalsDto extends createZodDto(
  ListPersonProfileRemovalsSchema,
) {}
