import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

const electedOfficeSupportQuerySchema = z.object({
  electedOfficeId: z.guid(),
})

export class ElectedOfficeSupportQueryDTO extends createZodDto(
  electedOfficeSupportQuerySchema,
) {}
