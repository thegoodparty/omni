import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { zDate } from '@goodparty_org/contracts'

// Admin/ops payload to flag (or clear) a person's public profile for privacy
// removal. personId is the canonical civics Person (gp_candidate_id). note is a
// free-text ops record of what/why was requested.
const SetPersonProfileRemovalSchema = z
  .object({
    personId: z.guid('personId must be a valid UUID'),
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
  .object({ personId: z.guid('personId must be a valid UUID') })
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
