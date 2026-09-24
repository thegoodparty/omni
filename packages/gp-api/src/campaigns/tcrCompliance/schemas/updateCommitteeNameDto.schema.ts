import { createZodDto } from 'nestjs-zod'
import { UpdateCommitteeNameSchema } from '@goodparty_org/contracts'

export class UpdateCommitteeNameDto extends createZodDto(
  UpdateCommitteeNameSchema,
) {}
