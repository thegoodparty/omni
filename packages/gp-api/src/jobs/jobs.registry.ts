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
import { CampaignTrackerDispatchService } from '@/campaigns/campaignTracker/services/campaignTrackerDispatch.service'
import { CommunityIssueDispatchService } from '@/communityIssues/services/communityIssueDispatch.service'
import { ManagedPanelWaveJobService } from '@/managedPanelWaves/managedPanelWaveJob.service'
import { MeetingBriefingsService } from '@/meetings/services/meetingBriefings.service'
import { OrdinanceDispatchService } from '@/ordinances/services/ordinanceDispatch.service'
import { PriorityRoundTwoDrawService } from '@/priorities/services/priorityRoundTwoDraw.service'
import { OpponentResearchScheduleService } from '@/raceOpponent/services/opponentResearchSchedule.service'
import { PollExecutionService } from '@/polls/services/pollExecution.service'
import { OutreachEmailEventsService } from '@/emailOutreach/services/outreachEmailEvents.service'
import { OutreachEmailInboundService } from '@/emailOutreach/services/outreachEmailInbound.service'
import { OutreachEmailLifecycleService } from '@/emailOutreach/services/outreachEmailLifecycle.service'
import { OutreachEmailPrepareService } from '@/emailOutreach/services/outreachEmailPrepare.service'
import { OutreachEmailSendSweepService } from '@/emailOutreach/services/outreachEmailSendSweep.service'
import { CampaignTcrComplianceService } from '@/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { CvStatusPollService } from '@/campaigns/tcrCompliance/services/cvStatusPoll.service'
import { Nightly10DlcReportService } from '@/campaigns/tcrCompliance/services/nightly10DlcReport.service'

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
  // Agent-run dispatchers fanned out by their daily schedules, one office,
  // org, row or campaign each. The agent platform queues the runs themselves.
  // The briefing and community-issue crons dispatched 10 offices at a time
  // (each one an S3 read, election-db lookups and a dispatch), so their jobs
  // keep that fleet-wide.
  meetingBriefingDispatch: defineJob({
    schema: z.object({ electedOfficeId: z.uuid() }),
    worker: (job, { get }) =>
      get(MeetingBriefingsService).dispatchDailyBriefing(job),
    alertAfterWaitingMinutes: 60,
    concurrency: 2,
    maxConcurrent: 10,
  }),
  communityIssueDispatch: defineJob({
    schema: z.object({
      organizationSlug: z.string().min(1),
      experimentType: z.enum(['top_community_issues', 'trending_issues']),
    }),
    worker: (job, { get }) =>
      get(CommunityIssueDispatchService).dispatchScheduled(job),
    alertAfterWaitingMinutes: 60,
    concurrency: 2,
    maxConcurrent: 10,
  }),
  ordinanceRefreshDispatch: defineJob({
    schema: z.object({ organizationSlug: z.string().min(1) }),
    worker: (job, { get }) =>
      get(OrdinanceDispatchService).dispatchRefresh(job),
    alertAfterWaitingMinutes: 60,
    concurrency: 2,
  }),
  // One at a time across the fleet, as the cron re-dispatched rows: each is
  // a paid opponent_research run.
  opponentResearchRedispatch: defineJob({
    schema: z.object({ researchId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OpponentResearchScheduleService).redispatch(job),
    alertAfterWaitingMinutes: 60,
    maxConcurrent: 1,
  }),
  campaignTrackerRegen: defineJob({
    schema: z.object({ campaignId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(CampaignTrackerDispatchService).regenerate(job),
    alertAfterWaitingMinutes: 60,
    concurrency: 2,
  }),
  // One step of one managed civic panel. Sent grouped by panel, so its steps
  // never overlap. Only the managedPanelWaves schedule sends it: it reaches
  // claimFree, which no request may.
  managedPanelWaveAdvance: defineJob({
    schema: z.object({ enrollmentId: z.uuid() }),
    worker: (job, { get }) => get(ManagedPanelWaveJobService).advanceWave(job),
    // The next hour's run sends the panel's next step.
    alertAfterWaitingMinutes: 30,
  }),
  // A Databricks sample and a model fit per send, so one at a time per task.
  priorityRoundTwoDraw: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(PriorityRoundTwoDrawService).drawScheduled(job),
    // Drawn on the last day staff can still take the send.
    alertAfterWaitingMinutes: 60,
    // Several Databricks reads against a warehouse that may be cold, a model
    // fit and two samples: past the default 15 minutes, a slow day would
    // fail every attempt. An expired attempt that is still running is safe,
    // since the draw claims the list in its transaction (sampledAt).
    timeoutMinutes: 60,
  }),
  priorityRoundTwoHandOff: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(PriorityRoundTwoDrawService).handOffStranded(job),
    alertAfterWaitingMinutes: 60,
  }),
  // Samples a new poll's recipients and posts the CSV to Slack for Tevyn to
  // text. Sent with the poll's row, grouped by poll with pollExpansion so a
  // poll's runs never overlap.
  pollCreation: defineJob({
    schema: z.object({ pollId: z.string().min(1) }),
    worker: (job, { get }) => get(PollExecutionService).runCreation(job),
    // Tevyn sends on the poll's scheduled date, and the user is told the
    // poll is scheduled.
    alertAfterWaitingMinutes: 30,
  }),
  // Samples a paid expansion's extra recipients, excluding everyone the poll
  // already texted, and posts them to Slack the same way.
  pollExpansion: defineJob({
    schema: z.object({ pollId: z.string().min(1) }),
    worker: (job, { get }) => get(PollExecutionService).runExpansion(job),
    alertAfterWaitingMinutes: 30,
  }),
  // Writes a due email send's audience, tenant and template. The due sweep
  // sends it with the send's start, and a delivery that runs out of time
  // sends the next one from its cursor. Grouped by send.
  emailSendPrepare: defineJob({
    schema: z.object({ outreachEmailId: z.number().int() }),
    worker: (job, { get }) =>
      get(OutreachEmailPrepareService).prepare(
        job.data.outreachEmailId,
        job.signal,
      ),
    // The send's time has come and nothing goes out until it is prepared.
    alertAfterWaitingMinutes: 10,
    // A delivery stops starting pages after 150 seconds, so one page in
    // flight and the trim finish well inside this. A hung one is retried
    // from the cursor sooner, since it holds the send's group meanwhile.
    timeoutMinutes: 5,
  }),
  // One reply SES stored in this environment's inbound bucket under its
  // message id. fromAuthenticated is SES's DMARC verdict from the SNS
  // notification; the stored message's own headers are the sender's.
  emailInbound: defineJob({
    schema: z.object({
      sesMessageId: z.string().min(1),
      fromAuthenticated: z.boolean(),
    }),
    worker: (job, { get }) =>
      get(OutreachEmailInboundService).process(
        job.data.sesMessageId,
        job.data.fromAuthenticated,
      ),
    // Replies are forwarded to the candidate or official.
    alertAfterWaitingMinutes: 30,
  }),
  // Whether Peerly activated a `pending` registration's usecase; approves
  // it and tells the candidate when it did. One per record, sent by the
  // tcrComplianceStatusSweep schedule.
  tcrComplianceStatusCheck: defineJob({
    schema: z.object({ tcrComplianceId: z.cuid() }),
    worker: (job, { get }) =>
      get(CampaignTcrComplianceService).checkUsecaseActivation(
        job.data.tcrComplianceId,
      ),
    // The sweep runs twice a day; nobody is waiting on one check.
    alertAfterWaitingMinutes: 60,
  }),
  // Launches the compliance_setup agent for a paid registration. Sent in the
  // transaction that claims kickoffSentAt, grouped by campaign.
  agenticComplianceKickoff: defineJob({
    schema: z.object({
      campaignId: z.number().int(),
      tcrComplianceId: z.cuid(),
      clerkUserId: z.string().min(1),
    }),
    worker: (job, { get }) =>
      get(CampaignTcrComplianceService).handleAgenticKickoff(job.data),
    // The candidate just paid and is waiting for their texting setup.
    alertAfterWaitingMinutes: 15,
  }),
  // Polls one campaign's fresh CV submission now, unpaced: the fresh scan
  // narrowed to that campaign, Pro and internal accounts included. The E2E
  // fixture `cvStatusPoll.scanFresh` is its caller today.
  cvStatusFreshScanCampaign: defineJob({
    schema: z.object({ campaignId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(CvStatusPollService).runFreshScan(`campaign-${job.id}`, {
        campaignId: job.data.campaignId,
        spacingMs: 0,
        signal: job.signal,
      }),
    alertAfterWaitingMinutes: 10,
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
  // 07:00 UTC daily. One meetingBriefingDispatch job per office that could
  // be due a briefing.
  meetingBriefingsDaily: defineSchedule({
    cron: '0 7 * * *',
    worker: (_job, { get }) =>
      get(MeetingBriefingsService).fanOutDailyBriefings(),
    alertAfterWaitingMinutes: 30,
  }),
  // 08:00 and 09:00 UTC daily: today's slice of offices for each
  // community-issue type.
  trendingIssuesDaily: defineSchedule({
    cron: '0 8 * * *',
    worker: (_job, { get }) =>
      get(CommunityIssueDispatchService).fanOutTrendingIssues(),
    alertAfterWaitingMinutes: 30,
  }),
  topCommunityIssuesDaily: defineSchedule({
    cron: '0 9 * * *',
    worker: (_job, { get }) =>
      get(CommunityIssueDispatchService).fanOutTopIssues(),
    alertAfterWaitingMinutes: 30,
  }),
  ordinanceRefreshDaily: defineSchedule({
    cron: '0 10 * * *',
    worker: (_job, { get }) =>
      get(OrdinanceDispatchService).fanOutDailyRefresh(),
    alertAfterWaitingMinutes: 30,
  }),
  opponentResearchRefreshDaily: defineSchedule({
    cron: '0 7 * * *',
    worker: (_job, { get }) =>
      get(OpponentResearchScheduleService).fanOutRefresh(),
    alertAfterWaitingMinutes: 30,
  }),
  // Thursday 15:00 UTC: 9 AM Central in winter, 10 AM in summer.
  campaignTrackerWeekly: defineSchedule({
    cron: '0 15 * * 4',
    worker: (_job, { get }) =>
      get(CampaignTrackerDispatchService).fanOutWeeklyRegen(),
    alertAfterWaitingMinutes: 30,
  }),
  // :19 past every hour, so a new panel's first wave and the wave after a
  // closed one are drawn within the hour rather than the next morning. Not
  // run from the approval itself: no request may reach claimFree
  // (adr/2026-10-22-managed-panel-free-sends-and-guards).
  managedPanelWaves: defineSchedule({
    cron: '19 * * * *',
    worker: (job, { get }) => get(ManagedPanelWaveJobService).fanOutWaves(job),
    alertAfterWaitingMinutes: 30,
  }),
  // 12:41 UTC daily: 7:41 AM Eastern in winter, 8:41 AM in summer.
  priorityRoundTwoDrawDue: defineSchedule({
    cron: '41 12 * * *',
    worker: (_job, { get }) => get(PriorityRoundTwoDrawService).fanOutDue(),
    alertAfterWaitingMinutes: 30,
  }),
  // Every ten minutes at :03: SES's per-email events from the Firehose
  // files in S3.
  emailEventSweep: defineSchedule({
    cron: '3-59/10 * * * *',
    worker: (job, { get }) =>
      get(OutreachEmailEventsService).sweepEvents(job.signal),
    alertAfterWaitingMinutes: 30,
    // Runs of a schedule wait on each other. A run stops starting files at 3
    // minutes, so this only ends one hung on an S3 read, before the next
    // run is due. Each event is a status compare-and-set, so the retry
    // overlapping a hung attempt applies nothing twice.
    timeoutMinutes: 8,
  }),
  // Every minute: start held email sends that are due, and send the prepare
  // of any that stalled.
  emailDueSweep: defineSchedule({
    cron: '* * * * *',
    worker: (_job, { get }) => get(OutreachEmailLifecycleService).sweepDue(),
    alertAfterWaitingMinutes: 10,
    // Runs of a schedule wait on each other, so a run hung on a Stripe call
    // would stop every start for the default 15 minutes. Each start is a
    // per-row compare-and-set, so the retry may overlap a hung attempt.
    timeoutMinutes: 5,
  }),
  // Every minute: settle and close out finished or stopping email sends.
  emailSettleSweep: defineSchedule({
    cron: '* * * * *',
    worker: (_job, { get }) => get(OutreachEmailLifecycleService).sweepSettle(),
    alertAfterWaitingMinutes: 10,
    // As emailDueSweep: each settle is a per-row compare-and-set or the hold
    // module's own claim.
    timeoutMinutes: 5,
  }),
  // Every minute: one paced send tick of up to 50 seconds, under the
  // email_sweep_lease row, the single SES sender across tasks.
  emailSendSweep: defineSchedule({
    cron: '* * * * *',
    worker: (job, { get }) =>
      get(OutreachEmailSendSweepService).sweep(job.signal),
    alertAfterWaitingMinutes: 10,
    // Runs of a schedule wait on each other, so a hung tick would stop every
    // send for the default 15 minutes.
    timeoutMinutes: 2,
  }),
  // Every 10 minutes: paid 10DLC registrations whose agent kickoff never
  // went out get one agenticComplianceKickoff job each.
  tcrStrandedKickoffSweep: defineSchedule({
    cron: '7-59/10 * * * *',
    worker: (_job, { get }) =>
      get(CampaignTcrComplianceService).sweepStrandedAgenticKickoffs(),
    alertAfterWaitingMinutes: 30,
  }),
  // Hourly at :23: submits the usecase for CV-verified records whose in-app
  // approve threw, one record at a time under a per-record lock, since two
  // submissions would double-finalize the brand.
  tcrUnsubmittedUsecaseSweep: defineSchedule({
    cron: '23 * * * *',
    worker: (_job, { get }) =>
      get(CampaignTcrComplianceService).runUnsubmittedUsecaseSweep(),
    alertAfterWaitingMinutes: 60,
    // A record's submission may hold its lock for up to 10 minutes of Peerly
    // calls, so a pass over a few slow records outlasts the default 15. Just
    // under the hourly cadence; a pass cut off leaves the rest to the next
    // run, and the per-record lock keeps a retry off a record still in
    // flight.
    timeoutMinutes: 55,
  }),
  // 00:00 and 12:00 UTC: 7am/7pm Eastern in winter, 8am/8pm in summer. One
  // tcrComplianceStatusCheck job per `pending` registration.
  tcrComplianceStatusSweep: defineSchedule({
    cron: '0 0,12 * * *',
    worker: (_job, { get }) =>
      get(CampaignTcrComplianceService).fanOutStatusChecks(),
    alertAfterWaitingMinutes: 60,
  }),
  // 01:00 and 13:00 UTC: 8pm/8am Eastern in winter, 9pm/9am in summer. The
  // Peerly-agreed twice-daily CV scan, paced at 1 retrieve_cv a minute.
  cvStatusScan: defineSchedule({
    cron: '0 1,13 * * *',
    worker: (job, { get }) => get(CvStatusPollService).runScheduledScan(job),
    alertAfterWaitingMinutes: 60,
    // At most 300 records a minute apart, then the profile pass.
    timeoutMinutes: 6 * 60,
  }),
  // :09 and :39: the fresh-submission fast poll, at most 15 records a
  // minute apart.
  cvStatusFreshScan: defineSchedule({
    cron: '9,39 * * * *',
    worker: (job, { get }) =>
      get(CvStatusPollService).runScheduledFreshScan(job),
    alertAfterWaitingMinutes: 30,
    timeoutMinutes: 25,
  }),
  // 05:00 UTC: midnight Eastern in winter, 1am in summer. Prod only, inside
  // the worker.
  nightly10DlcReport: defineSchedule({
    cron: '0 5 * * *',
    worker: (_job, { get }) =>
      get(Nightly10DlcReportService).runNightlyReport(),
    alertAfterWaitingMinutes: 60,
  }),
  // Weekdays 16:00 UTC: 11am Eastern in winter, noon in summer, inside
  // Peerly's business hours either way. Prod only, inside the worker.
  peerlyVendorEscalation: defineSchedule({
    cron: '0 16 * * 1-5',
    worker: (_job, { get }) =>
      get(Nightly10DlcReportService).runVendorEscalations(),
    alertAfterWaitingMinutes: 60,
  }),
}

export type Schedules = typeof SCHEDULES
export type ScheduleName = keyof Schedules
