import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

const electedOfficeSupportQuerySchema = z.object({
  electedOfficeId: z.string().uuid(),
})

export class ElectedOfficeSupportQueryDTO extends createZodDto(
  electedOfficeSupportQuerySchema,
) {}
