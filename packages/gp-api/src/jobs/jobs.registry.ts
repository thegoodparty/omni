import type { Type } from '@nestjs/common'
import type {
  JobWithMetadata,
  QueuePolicy,
  UpdateQueueOptions,
  WorkOptions,
} from 'pg-boss'
import { z } from 'zod'

// The fields a worker may read.
export type JobRun<T extends object> = Pick<
  JobWithMetadata<T>,
  'id' | 'data' | 'retryCount' | 'retryLimit' | 'signal'
>

export type WorkerContext = {
  // Any provider in the app, e.g. get(ContactUploadsService).
  get: <S>(type: Type<S>) => S
}

export type JobDefinition<T extends object> = {
  schema: z.ZodType<T>
  // Set when the queue is created. pg-boss cannot change it afterwards, so
  // changing it means a new queue name. See src/jobs/AGENTS.md § Ordering.
  policy?: QueuePolicy
  queue: Omit<
    UpdateQueueOptions,
    'deadLetter' | 'retryDelayMax' | 'heartbeatSeconds'
  >
  work: Omit<WorkOptions, 'batchSize' | 'includeMetadata' | 'perJobResults'>
  // How long a job may wait, ready, before its queue counts as backed up and
  // the jobs-backed-up alert fires.
  maxWaitSeconds: number
  // Return to complete the job; throw to retry it.
  worker: (job: JobRun<T>, context: WorkerContext) => Promise<void>
}

// Infers the worker's payload type from the schema.
export const defineJob = <T extends object>(
  definition: JobDefinition<T>,
): JobDefinition<T> => definition

// Every job gp-api runs, keyed by pg-boss queue name. Only JobsModule imports
// this at runtime: workers import feature services, and feature services
// import JobsService, so anything else importing it would close a cycle.
export const JOBS = {}

export type Jobs = typeof JOBS
export type JobName = keyof Jobs
export type JobData<N extends JobName> = z.infer<Jobs[N]['schema']>
