import { createZodDto } from 'nestjs-zod'
import { JobDeadLettersListQuerySchema } from '@goodparty_org/contracts'

export class AdminJobDeadLettersListQueryDto extends createZodDto(
  JobDeadLettersListQuerySchema,
) {}

export {
  JobDeadLetterSchema,
  type JobDeadLetter,
  JobDeadLetterQueuesSchema,
  RedriveJobDeadLetterResultSchema,
  type RedriveJobDeadLetterResult,
} from '@goodparty_org/contracts'
