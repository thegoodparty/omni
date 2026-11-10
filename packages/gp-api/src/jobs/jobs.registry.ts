import type { Type } from '@nestjs/common'
import type { JobWithMetadata } from 'pg-boss'
import { z } from 'zod'
import { ContactUploadProcessJobService } from '@/contactUploads/services/contactUploadProcessJob.service'
import { WeeklyTasksDigestService } from '@/campaigns/tasks/services/weeklyTasksDigest.service'
import { WeeklyTasksDigestHandlerService } from '@/campaigns/tasks/services/weeklyTasksDigestHandler.service'

// The fields a worker may read.
export type JobRun<T extends object> = Pick<
  JobWithMetadata<T>,
  'id' | 'data' | 'retryCount' | 'retryLimit' | 'signal'
>

export type WorkerContext = {
  // Any provider in the app, e.g. get(ContactUploadsService).
  get: <S>(type: Type<S>) => S
}

// Everything else about a queue is fixed in JobsService: strict FIFO per
// group, retry backoff, heartbeats, dead-lettering. src/jobs/AGENTS.md.
export type JobDefinition<T extends object> = {
  // The payload. Identifiers only: payloads are logged.
  schema: z.ZodType<T>
  // Return to complete the job; throw to retry it. Method syntax on purpose:
  // its parameter is bivariant, so JobsService can hold every definition as
  // JobDefinition<object>. Safe because JobsService only ever hands a worker
  // the payload its own schema parsed.
  worker(job: JobRun<T>, context: WorkerContext): Promise<void>
  // Pages someone when the oldest ready job has waited this long. Dev and
  // prod add tasks from half of it (src/jobs/AGENTS.md § Scaling).
  alertAfterWaitingMinutes: number
  // How long one attempt may run before it is failed and retried.
  // Default 15.
  timeoutMinutes?: number
  // Tries in total, the first included, before the job is dead-lettered.
  // Default 3.
  attempts?: number
  // Jobs of this type one gp-api task runs at once. Autoscaling adds tasks.
  // Default 1.
  concurrency?: number
}

// Infers the worker's payload type from the schema.
export const defineJob = <T extends object>(
  definition: JobDefinition<T>,
): JobDefinition<T> => definition

// A scheduled run carries no payload: the worker reads what it needs when it
// runs.
export type ScheduleData = Record<string, never>

// Each schedule gets its own queue, set up exactly like a job's, and every
// run of it shares one group, so a slow run delays the next instead of
// overlapping it. src/jobs/AGENTS.md § Schedules.
export type ScheduleDefinition = {
  // Five fields, always read in UTC. pg-boss sends at most one job a minute,
  // so a seconds field adds nothing; a job that needs seconds stays on @Cron.
  cron: string
  // Method syntax for the reason given on JobDefinition.worker.
  worker(job: JobRun<ScheduleData>, context: WorkerContext): Promise<void>
  // Same meaning and defaults as on JobDefinition.
  alertAfterWaitingMinutes: number
  timeoutMinutes?: number
  attempts?: number
}

export const defineSchedule = (
  definition: ScheduleDefinition,
): ScheduleDefinition => definition

// Every job gp-api runs, keyed by pg-boss queue name. Only JobsModule imports
// this at runtime: workers import feature services, and feature services
// import JobsService, so anything else importing it would close a cycle.
export const JOBS = {
  contactUploadProcess: defineJob({
    schema: z.object({ uploadId: z.uuid() }),
    worker: (job, { get }) => get(ContactUploadProcessJobService).process(job),
    // The user is watching the import page.
    alertAfterWaitingMinutes: 10,
    // A 25 MB file is dozens of Databricks round trips.
    timeoutMinutes: 120,
    // Rows insert with skipDuplicates and only pending rows are matched, so
    // a retry resumes where the last attempt stopped. A deploy that stops a
    // task mid-import spends one attempt, hence the headroom.
    attempts: 6,
    concurrency: 4,
  }),
  weeklyTasksDigestCampaign: defineJob({
    schema: z.object({
      campaignId: z.number().int().positive(),
      windowStart: z.iso.datetime(),
      windowEnd: z.iso.datetime(),
    }),
    worker: (job, { get }) =>
      get(WeeklyTasksDigestHandlerService).sendCampaignDigest(job),
    // The fan-out sends every campaign at once on Sunday night, and the
    // digest emails go out Monday morning.
    alertAfterWaitingMinutes: 60,
    attempts: 3,
    concurrency: 4,
  }),
}

export type Jobs = typeof JOBS
export type JobName = keyof Jobs
export type JobData<N extends JobName> = z.infer<Jobs[N]['schema']>

// Every schedule gp-api runs, keyed by pg-boss queue name. A name must not
// also be a JOBS key; JobsService refuses to boot if one is. Schedules are
// synced with the database at boot, so deleting an entry stops it.
export const SCHEDULES = {
  // Monday 04:00 UTC: Sunday evening Central all year (10 PM in winter,
  // 11 PM in summer). Sends one weeklyTasksDigestCampaign job per campaign
  // with a digest for the coming week.
  weeklyTasksDigest: defineSchedule({
    cron: '0 4 * * 1',
    worker: (_job, { get }) => get(WeeklyTasksDigestService).fanOut(),
    alertAfterWaitingMinutes: 30,
  }),
}

export type Schedules = typeof SCHEDULES
export type ScheduleName = keyof Schedules
