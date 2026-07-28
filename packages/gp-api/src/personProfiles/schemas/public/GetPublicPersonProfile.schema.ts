import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

const GetPublicPersonProfileSchema = z.object({
  personId: z.guid('personId must be a valid UUID'),
})

export class GetPublicPersonProfileDto extends createZodDto(
  GetPublicPersonProfileSchema,
) {}
