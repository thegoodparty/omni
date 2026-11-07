import type { JobWithMetadata, UpdateQueueOptions, WorkOptions } from 'pg-boss'
import { z } from 'zod'

export type JobDefinition = {
  schema: z.ZodType<object>
  queue: Omit<
    UpdateQueueOptions,
    'deadLetter' | 'retryDelayMax' | 'heartbeatSeconds'
  >
  work: Omit<WorkOptions, 'batchSize' | 'includeMetadata' | 'perJobResults'>
}

// Every job gp-api runs. The key is the pg-boss queue name. Each queue gets
// a dead-letter queue named by deadLetterQueue(), which no worker reads: a
// job lands there after its last retry, and the jobs-dead-letter alert fires
// until a developer redrives or deletes it (src/jobs/AGENTS.md). Its worker
// goes in jobs.workers.ts.
export const JOBS = {} satisfies Record<string, JobDefinition>

export type JobName = keyof typeof JOBS
export type JobData<N extends JobName> = z.infer<(typeof JOBS)[N]['schema']>
// The fields a worker may read.
export type JobRun<N extends JobName> = Pick<
  JobWithMetadata<JobData<N>>,
  'id' | 'data' | 'retryCount' | 'retryLimit' | 'signal'
>

export const JOB_NAMES = Object.keys(JOBS).filter(
  (name): name is JobName => name in JOBS,
)

export const deadLetterQueue = (name: JobName): string => `${name}-dlq`
