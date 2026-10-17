import { ServePollCreateSchema } from '@goodparty_org/contracts'
import { createZodDto } from 'nestjs-zod'
import { ZDateOnly } from 'src/shared/schemas/DateOnly.schema'

export class CreateInitialPollDto extends createZodDto(
  ServePollCreateSchema.pick({
    question: true,
    imageUrl: true,
    scheduledLocalDate: true,
  }).extend({ swornInDate: ZDateOnly }),
) {}
