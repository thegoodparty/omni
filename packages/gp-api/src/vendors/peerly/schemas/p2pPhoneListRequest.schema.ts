import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { voterFilterBaseSchema } from '../../../shared/schemas/voterFilterBase.schema'

export class P2pPhoneListRequestSchema extends createZodDto(
  voterFilterBaseSchema.extend({
    name: z.string().min(1),
    // Which saved segment (if any) this list was built from — stamped onto
    // the PeerlyPhoneList capture row so task 03/04 can trace a phone list
    // back to its filter. Same shape as CreateOutreachSchema's field.
    voterFileFilterId: z.coerce.number().int().positive().optional(),
  }),
) {}
