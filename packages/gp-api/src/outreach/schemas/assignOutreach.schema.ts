import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export class AssignOutreachDto extends createZodDto(
  z.object({
    assigneeUserId: z.number().int().positive(),
  }),
) {}
