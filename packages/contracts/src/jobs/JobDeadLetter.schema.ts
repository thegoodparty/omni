import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'

// A job pg-boss moved into a dead-letter queue after its last attempt failed
// (src/jobs/AGENTS.md § Dead letters). `sourceQueue` is the queue the job
// failed on, as the dead letter recorded it — never what a caller names. It
// is null for a dead letter that carries no recorded source, which can be
// read but not redriven.
export const JobDeadLetterSchema = z.object({
  id: z.string(),
  sourceQueue: z.string().nullable(),
  createdAt: zCoerceDate(),
  // Retries the job spent before it was dead-lettered.
  retriesUsed: z.number().int().nullable(),
  data: z.json(),
  // The last attempt's error message; null on a dead letter from before
  // pg-boss kept one.
  error: z.string().nullable(),
})

export type JobDeadLetter = z.infer<typeof JobDeadLetterSchema>

export const JOB_DEAD_LETTERS_MAX_LIMIT = 100

export const JobDeadLettersListQuerySchema = z.object({
  // Only dead letters whose job failed on this queue.
  sourceQueue: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(JOB_DEAD_LETTERS_MAX_LIMIT)
    .optional(),
})

export type JobDeadLettersListQuery = z.infer<
  typeof JobDeadLettersListQuerySchema
>

export const JobDeadLetterQueuesSchema = z.array(z.string())

export type JobDeadLetterQueues = z.infer<typeof JobDeadLetterQueuesSchema>

export const RedriveJobDeadLetterResultSchema = z.object({
  id: z.string(),
  sourceQueue: z.string(),
})

export type RedriveJobDeadLetterResult = z.infer<
  typeof RedriveJobDeadLetterResultSchema
>
