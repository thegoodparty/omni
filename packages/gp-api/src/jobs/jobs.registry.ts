import type { JobWithMetadata, UpdateQueueOptions, WorkOptions } from 'pg-boss'
import { z } from 'zod'

export type JobDefinition = {
  data: z.ZodType<object>
  queue: Omit<UpdateQueueOptions, 'deadLetter' | 'retryDelayMax'>
  // Set when the queue is created and never updated: pg-boss cannot change
  // it in place, so changing it means a new queue name.
  heartbeatSeconds?: number
  work: Omit<WorkOptions, 'batchSize' | 'includeMetadata' | 'perJobResults'>
}

// Every job a gp-api worker runs. The key is the pg-boss queue name. Each
// queue gets a dead-letter queue named by deadLetterQueue(), which no worker
// reads: a job lands there after its last retry, and the jobs-dead-letter
// alert fires until a developer redrives or deletes it (src/jobs/AGENTS.md).
export const JOBS = {} satisfies Record<string, JobDefinition>

export type JobName = keyof typeof JOBS
export type JobData<N extends JobName> = z.infer<(typeof JOBS)[N]['data']>
export type JobOf<N extends JobName> = JobWithMetadata<JobData<N>>
// The fields a handler may read. Narrower than JobOf so a test can call a
// handler with a plain object.
export type JobRun<N extends JobName> = Pick<
  JobOf<N>,
  'id' | 'data' | 'retryCount' | 'retryLimit' | 'signal'
>

export const JOB_NAMES = Object.keys(JOBS).filter(
  (name): name is JobName => name in JOBS,
)

export const deadLetterQueue = (name: JobName): string => `${name}__dead`
