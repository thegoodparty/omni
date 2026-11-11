import type { Type } from '@nestjs/common'
import type { JobWithMetadata } from 'pg-boss'
import { z } from 'zod'
import {
  FeedbackSynthesisCompleteEventSchema,
  PanelRepliesUploadedEventSchema,
} from '@goodparty_org/contracts'
import { ContactUploadProcessJobService } from '@/contactUploads/services/contactUploadProcessJob.service'
import { ContactUploadStuckService } from '@/contactUploads/services/contactUploadStuck.service'
import { WeeklyTasksDigestService } from '@/campaigns/tasks/services/weeklyTasksDigest.service'
import { WeeklyTasksDigestHandlerService } from '@/campaigns/tasks/services/weeklyTasksDigestHandler.service'
import { PaymentHoldsSweepService } from '@/paymentHolds/services/paymentHoldsSweep.service'
import { AnnotationAttachmentService } from '@/annotations/services/annotationAttachment.service'
import { ChatAttachmentsService } from '@/chats/services/chatAttachments.service'
import { CampaignPlanCompleteService } from '@/campaigns/tasks/services/campaignPlanComplete.service'
import { FeedbackSynthesisIngestService } from '@/constituentFeedback/services/feedbackSynthesisIngest.service'
import { OutreachPanelRepliesService } from '@/outreach/services/outreachPanelReplies.service'
import { PollAnalysisCompleteService } from '@/polls/services/pollAnalysisComplete.service'
import { AgentExperimentResultService } from '@/queue/inbox/agentExperimentResult.service'
import {
  AgentExperimentResultSchema,
  CampaignPlanCompleteMessageSchema,
  PollAnalysisCompleteEventSchema,
} from '@/queue/queue.types'
import { CampaignStrategyService } from '@/campaignStrategy/services/campaignStrategy.service'
import { DomainsService } from '@/websites/services/domains.service'
import { OrdinanceQualityLoopService } from '@/ordinances/services/ordinanceQualityLoop.service'

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
  // Jobs of this type running at once across every gp-api task, however
  // many there are. Unset: no cap beyond concurrency per task.
  maxConcurrent?: number
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
    // a retry resumes where the last attempt stopped.
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
  // One per hold, sent by the paymentHold* schedules below
  // (src/paymentHolds/AGENTS.md § Schedules).
  paymentHoldPlace: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) => get(PaymentHoldsSweepService).placeDueHold(job),
    alertAfterWaitingMinutes: 30,
  }),
  paymentHoldRecover: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(PaymentHoldsSweepService).recoverStaleHold(job),
    alertAfterWaitingMinutes: 30,
  }),
  paymentHoldSettleExpiring: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(PaymentHoldsSweepService).settleExpiringHold(job),
    alertAfterWaitingMinutes: 30,
  }),
  paymentHoldReconcileOrphan: defineJob({
    schema: z.object({ orphanedHoldId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(PaymentHoldsSweepService).reconcileOrphanedHold(job),
    alertAfterWaitingMinutes: 30,
  }),
  paymentHoldReleaseUnpaid: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(PaymentHoldsSweepService).releaseUnpaidHold(job),
    alertAfterWaitingMinutes: 30,
  }),
  paymentHoldRemind: defineJob({
    // day is the sweep's UTC date, yyyy-mm-dd: the reminder's messageId.
    schema: z.object({
      outreachId: z.number().int().positive(),
      day: z.iso.date(),
    }),
    worker: (job, { get }) =>
      get(PaymentHoldsSweepService).remindFailedHold(job),
    alertAfterWaitingMinutes: 30,
  }),
  ocrAttachment: defineJob({
    schema: z.object({ attachmentId: z.cuid() }),
    worker: (job, { get }) =>
      get(AnnotationAttachmentService).runOcr(job.data.attachmentId),
    // The note shows the file as processing until its text lands.
    alertAfterWaitingMinutes: 5,
  }),
  extractChatAttachment: defineJob({
    schema: z.object({ attachmentId: z.uuid() }),
    worker: (job, { get }) =>
      get(ChatAttachmentsService).runExtraction(job.data.attachmentId),
    // The chat shows the file as reading until its text lands.
    alertAfterWaitingMinutes: 5,
  }),
  // The five below arrive on SQS from other systems, and the consumer
  // forwards each message's data here (src/queue/AGENTS.md).
  pollAnalysisComplete: defineJob({
    schema: PollAnalysisCompleteEventSchema.shape.data,
    worker: (job, { get }) =>
      get(PollAnalysisCompleteService).handlePollAnalysisComplete(job.data),
    // The official is waiting on the results email.
    alertAfterWaitingMinutes: 30,
  }),
  feedbackSynthesisComplete: defineJob({
    schema: FeedbackSynthesisCompleteEventSchema.shape.data,
    worker: (job, { get }) =>
      get(FeedbackSynthesisIngestService).handle({
        type: 'feedbackSynthesisComplete',
        data: job.data,
      }),
    // The stale-run sweep fails a run still running after 30 minutes, and
    // the report shows it in flight until then.
    alertAfterWaitingMinutes: 10,
  }),
  panelRepliesUploaded: defineJob({
    schema: PanelRepliesUploadedEventSchema,
    worker: (job, { get }) =>
      get(OutreachPanelRepliesService).handleUpload(job.data),
    alertAfterWaitingMinutes: 30,
  }),
  campaignPlanComplete: defineJob({
    schema: CampaignPlanCompleteMessageSchema,
    worker: (job, { get }) =>
      get(CampaignPlanCompleteService).handleCampaignPlanComplete(job.data),
    alertAfterWaitingMinutes: 30,
  }),
  agentExperimentResult: defineJob({
    schema: AgentExperimentResultSchema,
    worker: (job, { get }) =>
      get(AgentExperimentResultService).handleAgentExperimentResult(job.data),
    // A run's user is waiting on its result.
    alertAfterWaitingMinutes: 10,
  }),
  // Sent on every campaign story write (the story page, the website about
  // section, the Campaign Manager chat), so the plan can be regenerated once
  // the story is complete. The worker decides completeness and is cheap when
  // the story is incomplete or unchanged. A job, not a direct call, because
  // campaignStrategy already depends on the campaignStory and websites
  // modules, and it keeps a story autosave off the regeneration's latency.
  campaignStoryCompleted: defineJob({
    schema: z.object({ campaignId: z.number().int().positive() }),
    // Best-effort: it logs and swallows its own errors, and the plan still
    // regenerates on the candidate's next plan read.
    worker: (job, { get }) =>
      get(CampaignStrategyService).regenerateOnStoryComplete(
        job.data.campaignId,
      ),
    // Nobody waits on it; the plan read regenerates too.
    alertAfterWaitingMinutes: 30,
  }),
  // Sent at every task boot for each domain without email forwarding.
  domainEmailForwarding: defineJob({
    schema: z.object({ domainId: z.number().int().positive() }),
    worker: (job, { get }) => get(DomainsService).setupEmailForwardingJob(job),
    // Internal setup; nobody is watching it.
    alertAfterWaitingMinutes: 60,
  }),
  // One LLM step (qc or revise) of an ordinance's quality loop. Each step
  // sends the next. src/ordinances/AGENTS.md § Loop semantics.
  ordinanceQualityLoopStep: defineJob({
    schema: z.object({
      ordinanceId: z.string(),
      loopRunId: z.string(),
      iteration: z.number().int(),
      phase: z.enum(['qc', 'revise']),
      expectedInputHash: z.string(),
      attempt: z.number().int(),
    }),
    worker: async (job, { get }) => {
      const done = await get(OrdinanceQualityLoopService).handleStep(
        job.data,
        job.signal,
      )
      // The run is still ours but a concurrent write moved the ordinance's
      // updatedAt under the step. Position resolution makes the retry safe.
      if (!done) {
        throw new Error('ordinance quality loop step lost a write race')
      }
    },
    // The official sees the loop's progress on the draft page.
    alertAfterWaitingMinutes: 10,
    // Each step's LLM call has its own 4-minute budget.
    timeoutMinutes: 10,
  }),
}

export type Jobs = typeof JOBS
export type JobName = keyof Jobs
export type JobData<N extends JobName> = z.infer<Jobs[N]['schema']>

// Every schedule gp-api runs, keyed by pg-boss queue name. A name must not
// also be a JOBS key; JobsService refuses to boot if one is. Schedules are
// synced with the database at boot, so deleting an entry stops it.
export const SCHEDULES = {
  // Every 5 minutes, off the hour: uploads still processing whose job
  // pg-boss gave up on are marked failed, for organizations nobody is
  // looking at. The uploads routes and email confirm do the same for their
  // own organization first.
  contactUploadStuckSweep: defineSchedule({
    cron: '3-59/5 * * * *',
    worker: async (_job, { get }) => {
      await get(ContactUploadStuckService).failStuck()
    },
    alertAfterWaitingMinutes: 30,
  }),
  // Monday 04:00 UTC: Sunday evening Central all year (10 PM in winter,
  // 11 PM in summer). Sends one weeklyTasksDigestCampaign job per campaign
  // with a digest for the coming week.
  weeklyTasksDigest: defineSchedule({
    cron: '0 4 * * 1',
    worker: (_job, { get }) => get(WeeklyTasksDigestService).fanOut(),
    alertAfterWaitingMinutes: 30,
  }),
  // The payment hold sweeps (src/paymentHolds/AGENTS.md § Schedules). Every
  // minute of the ten-minute family already has a job. Recovery sits beside a
  // non-Stripe job; placement shares :01/:31 with robocall's deferred hold
  // sweep, a handful of Stripe calls each.
  paymentHoldPlacementSweep: defineSchedule({
    cron: '1,11,21,31,41,51 * * * *',
    worker: (job, { get }) =>
      get(PaymentHoldsSweepService).sweepPlacements(job),
    alertAfterWaitingMinutes: 30,
  }),
  paymentHoldRecoverySweep: defineSchedule({
    cron: '6,16,26,36,46,56 * * * *',
    worker: (job, { get }) =>
      get(PaymentHoldsSweepService).sweepStaleClaims(job),
    alertAfterWaitingMinutes: 30,
  }),
  paymentHoldExpiryGuard: defineSchedule({
    cron: '38 * * * *',
    worker: (job, { get }) =>
      get(PaymentHoldsSweepService).settleExpiringHolds(job),
    alertAfterWaitingMinutes: 30,
  }),
  paymentHoldReconcileSweep: defineSchedule({
    cron: '24 * * * *',
    worker: (job, { get }) =>
      get(PaymentHoldsSweepService).reconcileOrphanedHolds(job),
    alertAfterWaitingMinutes: 30,
  }),
  paymentHoldUnpaidSweep: defineSchedule({
    cron: '5,15,25,35,45,55 * * * *',
    worker: (job, { get }) =>
      get(PaymentHoldsSweepService).releaseUnpaidHolds(job),
    alertAfterWaitingMinutes: 30,
  }),
  // 15:18 UTC: 10:18 AM Eastern in winter, 11:18 AM in summer.
  paymentHoldReminderSweep: defineSchedule({
    cron: '18 15 * * *',
    worker: (_job, { get }) =>
      get(PaymentHoldsSweepService).remindFailedHolds(),
    alertAfterWaitingMinutes: 30,
  }),
}

export type Schedules = typeof SCHEDULES
export type ScheduleName = keyof Schedules
