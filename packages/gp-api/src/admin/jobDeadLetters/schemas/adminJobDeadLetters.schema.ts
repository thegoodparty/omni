import { createZodDto } from 'nestjs-zod'
import {
  JobDeadLettersBatchSchema,
  JobDeadLettersListQuerySchema,
} from '@goodparty_org/contracts'

export class AdminJobDeadLettersListQueryDto extends createZodDto(
  JobDeadLettersListQuerySchema,
) {}

export class AdminJobDeadLettersBatchDto extends createZodDto(
  JobDeadLettersBatchSchema,
) {}

export {
  JobDeadLetterSchema,
  type JobDeadLetter,
  JobDeadLetterQueuesSchema,
  type JobDeadLetterQueues,
  DeleteJobDeadLetterResultSchema,
  type DeleteJobDeadLetterResult,
  DeleteJobDeadLettersResultSchema,
  type DeleteJobDeadLettersResult,
  RedriveJobDeadLetterResultSchema,
  type RedriveJobDeadLetterResult,
  RedriveJobDeadLettersResultSchema,
  type RedriveJobDeadLettersResult,
} from '@goodparty_org/contracts'
