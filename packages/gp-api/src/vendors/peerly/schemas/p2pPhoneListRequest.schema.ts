import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { voterFilterBaseSchema } from '../../../shared/schemas/voterFilterBase.schema'

// Exported (not just the DTO class) so the async build handler can
// re-validate the JSON snapshot persisted on the build row — it was already
// validated once at accept time, but a persisted blob is read back as
// `unknown`, and this is the one place both the request and the snapshot are
// trusted to agree on shape.
export const p2pPhoneListRequestSchema = voterFilterBaseSchema.extend({
  name: z.string().min(1),
  // Which saved segment (if any) this list was built from — stamped onto
  // the PeerlyPhoneList capture row so task 03/04 can trace a phone list
  // back to its filter. Same shape as CreateOutreachSchema's field.
  voterFileFilterId: z.coerce.number().int().positive().optional(),
})

export class P2pPhoneListRequestSchema extends createZodDto(
  p2pPhoneListRequestSchema,
) {}
