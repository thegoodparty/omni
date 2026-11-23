import { createZodDto } from 'nestjs-zod'
import { JobDeadLettersListQuerySchema } from '@goodparty_org/contracts'

export class AdminJobDeadLettersListQueryDto extends createZodDto(
  JobDeadLettersListQuerySchema,
) {}

export {
  DeleteJobDeadLetterResultSchema,
  type DeleteJobDeadLetterResult,
  JobDeadLetterSchema,
  type JobDeadLetter,
  JobDeadLetterQueuesSchema,
  RedriveJobDeadLetterResultSchema,
  type RedriveJobDeadLetterResult,
} from '@goodparty_org/contracts'
