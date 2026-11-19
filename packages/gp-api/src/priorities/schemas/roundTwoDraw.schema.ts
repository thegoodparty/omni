import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export class RoundTwoOutreachParamDto extends createZodDto(
  z.object({ outreachId: z.coerce.number().int().positive() }),
) {}

export const RoundTwoDrawResponseSchema = z.object({
  drawn: z.boolean(),
  recipientCount: z.number().int().nonnegative(),
})
