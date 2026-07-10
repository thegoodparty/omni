import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export class SubmitCrmRegistrationSchema extends createZodDto(
  z.object({
    hutk: z.string().min(1).max(255).optional(),
  }),
) {}
