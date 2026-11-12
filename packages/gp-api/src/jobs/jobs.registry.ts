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
import { FeedbackSynthesisIngestService } from '@/constituentFeedback/services/feedbackSynthesisIngest.service'
import { OutreachPanelRepliesService } from '@/outreach/services/outreachPanelReplies.service'
import { PollAnalysisCompleteService } from '@/polls/services/pollAnalysisComplete.service'
import { AgentExperimentResultService } from '@/queue/inbox/agentExperimentResult.service'
import {
  AgentExperimentResultSchema,
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
import { PriorityReadService } from '@/priorities/services/priorityRead.service'
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
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { PersonIdReconcileService } from '@/personProfiles/services/person-id-reconcile.service'
import { ScheduledMessagingService } from '@/scheduled-messaging/scheduled-messaging.service'
import { VendorMockRecordAuditService } from '@/vendorMocks/vendorMockRecordAudit.service'
import { VendorDriftProbeService } from '@/vendors/vendorDriftProbe.service'
import { PendingTranscriptionService } from '@/constituentFeedback/services/pendingTranscription.service'
import { SynthesisStaleRunSweepService } from '@/constituentFeedback/services/synthesisStaleRunSweep.service'
import { ContactUploadAbandonedSweepService } from '@/contactUploads/services/contactUploadAbandonedSweep.service'
import { DoorKnockingStatsService } from '@/doorKnocking/services/doorKnockingStats.service'
import { WinOfficeService } from '@/electedOffice/services/winOffice.service'
import { ManagedPanelFundingReconcileService } from '@/outreach/services/managedPanelFundingReconcile.service'
import { OutreachDraftExpiryService } from '@/outreach/services/outreachDraftExpiry.service'
import { OutreachPollReviewOverdueService } from '@/outreach/services/outreachPollReviewOverdue.service'
import { PriorityAnswerCodingService } from '@/priorities/services/priorityAnswerCoding.service'
import { UsersService } from '@/users/services/users.service'
import { OutreachRobocallBacklogAlertService } from '@/outreach/services/outreachRobocallBacklogAlert.service'
import { OutreachRobocallCallhubCleanupService } from '@/outreach/services/outreachRobocallCallhubCleanup.service'
import { OutreachRobocallCaptureService } from '@/outreach/services/outreachRobocallCapture.service'
import { OutreachRobocallCompletionService } from '@/outreach/services/outreachRobocallCompletion.service'
import { OutreachRobocallDeferredHoldService } from '@/outreach/services/outreachRobocallDeferredHold.service'
import { OutreachRobocallFreshChargeService } from '@/outreach/services/outreachRobocallFreshCharge.service'
import { OutreachRobocallHoldFailureService } from '@/outreach/services/outreachRobocallHoldFailure.service'
import { OutreachRobocallHoldReconcileService } from '@/outreach/services/outreachRobocallHoldReconcile.service'
import { OutreachRobocallHoldRecoveryService } from '@/outreach/services/outreachRobocallHoldRecovery.service'
import { OutreachRobocallOverdueAlertService } from '@/outreach/services/outreachRobocallOverdueAlert.service'
import { OutreachRobocallSendService } from '@/outreach/services/outreachRobocallSend.service'
import { OutreachRobocallStagingService } from '@/outreach/services/outreachRobocallStaging.service'
import { OutreachRobocallStrandedService } from '@/outreach/services/outreachRobocallStranded.service'
import { OutreachCompletionService } from '@/outreach/services/outreachCompletion.service'
import { OutreachInboundSweepService } from '@/outreach/services/outreachInboundSweep.service'
import { OutreachP2pSmsCaptureService } from '@/outreach/services/outreachP2pSmsCapture.service'
import { OutreachP2pSmsReconcileService } from '@/outreach/services/outreachP2pSmsReconcile.service'
import { OutreachTextHandoffService } from '@/outreach/services/outreachTextHandoff.service'
import { OutreachTextSendJobService } from '@/outreach/services/outreachTextSendJob.service'
import { P2pPhoneListUploadService } from '@/vendors/peerly/services/p2pPhoneListUpload.service'

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
    // `elected_office.id` is TEXT with no format constraint, and prod holds
    // rows whose id is v7-shaped but not an RFC 4122 UUID. Every row the
    // fan-out selects must be able to become a job, or `sendMany` throws on
    // the whole batch and the day's briefings never dispatch (ENG-11627).
    schema: z.object({ electedOfficeId: z.string().min(1) }),
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
  // One priority's read: warehouse reads and a model fit on its own thread.
  // Queued when answers are coded, when a view finds the stored read stale,
  // and daily. Grouped by priority, so the newest refresh lands last.
  priorityReadRefresh: defineJob({
    schema: z.object({ priorityId: z.string().min(1) }),
    worker: (job, { get }) => get(PriorityReadService).refresh(job),
    // The priority page, Home and the assistants show the previous read
    // until it lands.
    alertAfterWaitingMinutes: 15,
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
  // One AWAITING_RESUME agent run whose resume came due. Each resume is a
  // paid agent run, so a run that fails here retries on its own.
  experimentRunResume: defineJob({
    schema: z.object({ runId: z.uuid() }),
    worker: (job, { get }) => get(ExperimentRunsService).resumeDueRun(job),
    alertAfterWaitingMinutes: 30,
    // A retry that finds an earlier attempt's claim still fresh throws until
    // the claim is stale, which can take a few backoffs.
    attempts: 5,
  }),
  // Serve and ops hygiene, one record each, fanned out by the schedules of
  // the same name below. None is waited on by a user.
  outreachDraftExpire: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) => get(OutreachDraftExpiryService).expireDraft(job),
    alertAfterWaitingMinutes: 60,
  }),
  // Model calls in batches of 20 replies. Sent grouped by the send.
  priorityAnswerCode: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(PriorityAnswerCodingService).codeScheduled(job),
    alertAfterWaitingMinutes: 30,
  }),
  // Creates or removes one campaign's dormant win office. A create syncs
  // the winner to HubSpot.
  winOfficeSync: defineJob({
    schema: z.object({ campaignId: z.number().int().positive() }),
    worker: (job, { get }) => get(WinOfficeService).syncScheduled(job),
    alertAfterWaitingMinutes: 60,
  }),
  // One org's canvassing totals to Segment, read by a HubSpot workflow.
  doorKnockingCanvassingTotals: defineJob({
    schema: z.object({ organizationSlug: z.string().min(1) }),
    worker: (job, { get }) =>
      get(DoorKnockingStatsService).emitScheduledCanvassingTotals(job),
    alertAfterWaitingMinutes: 60,
  }),
  contactUploadAbandonedDelete: defineJob({
    schema: z.object({ uploadId: z.uuid() }),
    worker: (job, { get }) =>
      get(ContactUploadAbandonedSweepService).deleteAbandoned(job),
    alertAfterWaitingMinutes: 60,
    // Up to 200 an hour, each an S3 delete and a row delete.
    concurrency: 4,
  }),
  // Sent grouped by the priority.
  feedbackSynthesisRepool: defineJob({
    schema: z.object({ runId: z.uuid() }),
    worker: (job, { get }) => get(SynthesisStaleRunSweepService).repool(job),
    alertAfterWaitingMinutes: 30,
  }),
  // Starts, polls or restarts one offline memo's Transcribe job. Sent every
  // minute, grouped by the memo.
  feedbackTranscriptionAdvance: defineJob({
    schema: z.object({ feedbackId: z.uuid() }),
    worker: (job, { get }) =>
      get(PendingTranscriptionService).advanceScheduled(job),
    alertAfterWaitingMinutes: 10,
  }),
  feedbackAbandonedConfirm: defineJob({
    schema: z.object({ feedbackId: z.uuid() }),
    worker: (job, { get }) =>
      get(PendingTranscriptionService).confirmAbandonedScheduled(job),
    alertAfterWaitingMinutes: 30,
  }),
  // One per robocall (or orphan row), sent by the robocall* schedules below
  // (src/outreach/docs/robocall-payment.md § Schedules). Each reads its row
  // back through its sweep's filter and acts behind the row's existing
  // compare-and-set claim, so a retry never dials, holds or charges twice.
  robocallStage: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachRobocallStagingService).stageDueDraft(job),
    alertAfterWaitingMinutes: 30,
    // A healthy stage (audio, media, a phonebook import that polls up to ~8
    // minutes, the create) must finish inside one attempt, and an expired
    // attempt must not outlive the 30-minute stale-staging reclaim that
    // takes the claim over (ROBOCALL_STAGING_STALE_MINUTES).
    timeoutMinutes: 25,
  }),
  robocallSettle: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachRobocallCompletionService).settleDueRun(job),
    alertAfterWaitingMinutes: 30,
  }),
  robocallCapture: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachRobocallCaptureService).captureDueRun(job),
    alertAfterWaitingMinutes: 30,
    // Seconds when healthy. Under the row's stale window
    // (ROBOCALL_CAPTURING_STALE_MINUTES, 15), so the retry an expired
    // attempt gets finds the row not yet stale, rather than recovering the
    // capture beside an attempt still in its Stripe call.
    timeoutMinutes: 10,
  }),
  robocallFreshCharge: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachRobocallFreshChargeService).chargeDueRun(job),
    alertAfterWaitingMinutes: 30,
    // As robocallCapture, against ROBOCALL_CHARGING_STALE_MINUTES (15).
    timeoutMinutes: 10,
  }),
  robocallHoldPendingRecover: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachRobocallHoldRecoveryService).recoverStaleHoldPending(job),
    alertAfterWaitingMinutes: 30,
    // As robocallCapture, against ROBOCALL_HOLD_PENDING_STALE_MINUTES (15).
    timeoutMinutes: 10,
  }),
  robocallOrphanedHoldReconcile: defineJob({
    schema: z.object({ orphanedHoldId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachRobocallHoldReconcileService).reconcileOrphanedHold(job),
    alertAfterWaitingMinutes: 30,
  }),
  robocallDeferredHoldPlace: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachRobocallDeferredHoldService).placeDeferredHold(job),
    alertAfterWaitingMinutes: 30,
    // Placement claims the row `hold_pending`. As robocallCapture, under
    // ROBOCALL_HOLD_PENDING_STALE_MINUTES (15), so an attempt hung on Stripe
    // has expired before robocallHoldPendingRecover can find the row stale.
    timeoutMinutes: 10,
  }),
  robocallDeferredCancel: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachRobocallDeferredHoldService).cancelExpiredDeferredDraft(job),
    alertAfterWaitingMinutes: 30,
  }),
  robocallHoldFailureRemind: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachRobocallHoldFailureService).remindDueDraft(job),
    alertAfterWaitingMinutes: 30,
  }),
  robocallHoldFailureCancel: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachRobocallHoldFailureService).cancelDueDraft(job),
    alertAfterWaitingMinutes: 30,
  }),
  robocallStrandedFail: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachRobocallStrandedService).failStrandedDraft(job),
    alertAfterWaitingMinutes: 30,
  }),
  robocallOrphanedCampaignAbort: defineJob({
    schema: z.object({ orphanedCampaignId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachRobocallCallhubCleanupService).abortOrphanedCampaign(job),
    alertAfterWaitingMinutes: 30,
  }),
  // A paid or free Serve text send handed to fulfilment. Producers send it
  // with sendMany and outreachTextSendJob(), keyed on (outreach, sendSeq)
  // and grouped per outreach (src/outreach/docs/text-delivery.md).
  outreachTextSend: defineJob({
    schema: z.object({
      outreachId: z.number().int().positive(),
      sendSeq: z.number().int().positive(),
      // Not an id: the managed panel wave's agent plan, decided when the wave
      // was claimed and stored nowhere else until delivery writes the
      // hand-off row from it. No PII.
      agentHandoff: z
        .strictObject({
          mode: z.enum(['shadow', 'auto']),
          sendAt: z.iso.datetime(),
          timeZone: z.string().refine((timeZone) => {
            try {
              new Intl.DateTimeFormat('en-US', { timeZone })
              return true
            } catch {
              return false
            }
          }, 'Not an IANA time zone'),
        })
        .optional(),
    }),
    worker: (job, { get }) => get(OutreachTextSendJobService).send(job),
    // A paid send whose official is waiting for it to go out.
    alertAfterWaitingMinutes: 15,
    // A large saved list resolves for minutes before the handoff.
    timeoutMinutes: 30,
    concurrency: 4,
  }),
  // A Win P2P phone list built and uploaded to Peerly; the candidate waits
  // on the review step. Sent keyed on (build, attempt), grouped per build.
  p2pPhoneListBuild: defineJob({
    schema: z.object({ buildId: z.uuid() }),
    worker: (job, { get }) =>
      get(P2pPhoneListUploadService).handleQueuedBuild(job),
    alertAfterWaitingMinutes: 10,
    // A 200k-recipient resolution can run ~17 minutes before the upload.
    timeoutMinutes: 30,
    concurrency: 2,
  }),
  // One per Win P2P SMS hold, sent by the p2pSms* schedules below
  // (src/outreach/docs/services.md).
  p2pSmsCaptureHold: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachP2pSmsCaptureService).captureDueHold(job),
    alertAfterWaitingMinutes: 30,
    // Seconds when healthy. Under the row's stale window
    // (P2P_SMS_CAPTURING_STALE_MINUTES, 15), so the retry an expired attempt
    // gets finds the row not yet stale, rather than recovering the capture
    // beside an attempt still in its Stripe call. As robocallCapture.
    timeoutMinutes: 10,
  }),
  p2pSmsCaptureRecover: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachP2pSmsCaptureService).recoverStaleCapture(job),
    alertAfterWaitingMinutes: 30,
    // As p2pSmsCaptureHold.
    timeoutMinutes: 10,
  }),
  p2pSmsRefundingReconcile: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachP2pSmsReconcileService).reconcileStrandedRefunding(job),
    alertAfterWaitingMinutes: 30,
  }),
  p2pSmsDeniedRelease: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachP2pSmsReconcileService).releaseDeniedHold(job),
    alertAfterWaitingMinutes: 30,
  }),
  p2pSmsStrandedVoid: defineJob({
    schema: z.object({ outreachId: z.number().int().positive() }),
    worker: (job, { get }) =>
      get(OutreachP2pSmsReconcileService).voidStrandedHold(job),
    alertAfterWaitingMinutes: 30,
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
  // 09:23 UTC daily, overnight in the US: one priorityReadRefresh per read
  // older than a day, for what changes under a read without a new answer.
  priorityReadRefreshDaily: defineSchedule({
    cron: '23 9 * * *',
    worker: (_job, { get }) => get(PriorityReadService).fanOutDaily(),
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
    worker: (job, { get }) =>
      get(OutreachEmailLifecycleService).sweepDue(job.signal),
    alertAfterWaitingMinutes: 10,
    // Runs of a schedule wait on each other, so a run hung on a Stripe call
    // would stop every start for the default 15 minutes. Each start is a
    // per-row compare-and-set, so the retry may overlap a hung attempt.
    timeoutMinutes: 5,
  }),
  // Every minute: settle and close out finished or stopping email sends.
  emailSettleSweep: defineSchedule({
    cron: '* * * * *',
    worker: (job, { get }) =>
      get(OutreachEmailLifecycleService).sweepSettle(job.signal),
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
  // approve threw, one record at a time under a per-record claim, since two
  // submissions would double-finalize the brand.
  tcrUnsubmittedUsecaseSweep: defineSchedule({
    cron: '23 * * * *',
    worker: (job, { get }) =>
      get(CampaignTcrComplianceService).runUnsubmittedUsecaseSweep(job.signal),
    alertAfterWaitingMinutes: 60,
    // A record's submission may hold its claim for up to 10 minutes of Peerly
    // calls, so a pass over a few slow records outlasts the default 15. Just
    // under the hourly cadence; a pass cut off leaves the rest to the next
    // run, and the per-record claim keeps a retry off a record still in
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
  // Every 5 minutes: sends one experimentRunResume job per agent run whose
  // resume is due.
  experimentRunResumeSweep: defineSchedule({
    cron: '*/5 * * * *',
    worker: (_job, { get }) => get(ExperimentRunsService).sweepResumableRuns(),
    alertAfterWaitingMinutes: 30,
  }),
  // 04:00 UTC, off-peak: links unlinked users to their person and re-checks
  // linked profile owners, a bounded batch of each.
  personIdReconcile: defineSchedule({
    cron: '0 4 * * *',
    worker: (_job, { get }) => get(PersonIdReconcileService).reconcile(),
    alertAfterWaitingMinutes: 60,
  }),
  // Hourly: sends the scheduled messages that have come due.
  scheduledMessagesSend: defineSchedule({
    cron: '27 * * * *',
    worker: async (_job, { get }) => {
      await get(ScheduledMessagingService).processScheduledMessages()
    },
    alertAfterWaitingMinutes: 60,
  }),
  // 11:17 UTC: 6:17 AM Eastern in winter, 7:17 AM in summer. Prod only.
  vendorMockRecordAudit: defineSchedule({
    cron: '17 11 * * *',
    worker: (_job, { get }) =>
      get(VendorMockRecordAuditService).reportMockRecordRows(),
    alertAfterWaitingMinutes: 60,
  }),
  // 09:41 UTC: 4:41 AM Eastern in winter, 5:41 AM in summer, before the
  // 10DLC owners' workday. Live vendor mode only.
  vendorDriftProbe: defineSchedule({
    cron: '41 9 * * *',
    worker: (_job, { get }) => get(VendorDriftProbeService).runNightlyProbe(),
    alertAfterWaitingMinutes: 60,
    // One try: another would call every vendor again, the billed Geoapify
    // call included. A probe a deploy interrupts is still requeued, but it
    // runs in seconds, well inside the shutdown grace.
    attempts: 1,
  }),
  // Every 10 minutes: quality loops stuck running are marked failed.
  ordinanceQualityLoopStallSweep: defineSchedule({
    cron: '*/10 * * * *',
    worker: (_job, { get }) => get(OrdinanceQualityLoopService).sweepStalled(),
    alertAfterWaitingMinutes: 30,
  }),
  // 09:37 UTC daily: 4:37 AM Eastern in winter, 5:37 AM in summer. One
  // outreachDraftExpire job per draft past its retention.
  outreachDraftExpiry: defineSchedule({
    cron: '37 9 * * *',
    worker: (job, { get }) => get(OutreachDraftExpiryService).fanOut(job),
    alertAfterWaitingMinutes: 30,
  }),
  // :33 past every hour. Logs each poll past its review SLA for the
  // serve-poll-review-overdue alert.
  pollReviewOverdue: defineSchedule({
    cron: '33 * * * *',
    worker: (_job, { get }) =>
      get(OutreachPollReviewOverdueService).logOverduePolls(),
    alertAfterWaitingMinutes: 30,
  }),
  // 11:47 UTC daily: 6:47 AM Eastern in winter, 7:47 AM in summer. Dev and
  // prod only (gate in the worker).
  managedPanelFundingReconcile: defineSchedule({
    cron: '47 11 * * *',
    worker: (_job, { get }) =>
      get(ManagedPanelFundingReconcileService).reconcileDaily(),
    alertAfterWaitingMinutes: 30,
  }),
  // Every 10 minutes from :06. One priorityAnswerCode job per priority send
  // of the last 30 days.
  priorityAnswerCodingSweep: defineSchedule({
    cron: '6-56/10 * * * *',
    worker: (job, { get }) => get(PriorityAnswerCodingService).fanOut(job),
    alertAfterWaitingMinutes: 30,
  }),
  // 11:19 UTC daily: 6:19 AM Eastern in winter, 7:19 AM in summer. One
  // winOfficeSync job per campaign whose office is missing or withdrawn.
  winOfficeSweep: defineSchedule({
    cron: '19 11 * * *',
    worker: (job, { get }) => get(WinOfficeService).fanOut(job),
    alertAfterWaitingMinutes: 30,
  }),
  // 10:00 UTC daily: 5 AM Eastern in winter, 6 AM in summer. After the
  // latest a canvasser plausibly syncs an evening walk, before the CS
  // workday reads the properties. One doorKnockingCanvassingTotals job per
  // org that recorded a knock in the last day.
  doorKnockingCanvassingTotalsSweep: defineSchedule({
    cron: '0 10 * * *',
    worker: (job, { get }) =>
      get(DoorKnockingStatsService).fanOutCanvassingTotals(job),
    alertAfterWaitingMinutes: 30,
  }),
  // :43 past every hour. One contactUploadAbandonedDelete job per upload
  // still waiting for its file a day on, 200 a run.
  contactUploadAbandonedSweep: defineSchedule({
    cron: '43 * * * *',
    worker: (job, { get }) =>
      get(ContactUploadAbandonedSweepService).fanOut(job),
    alertAfterWaitingMinutes: 30,
  }),
  // Every 10 minutes. Fails synthesis runs that never reported back, and
  // sends one feedbackSynthesisRepool job per run owed a re-pool.
  feedbackSynthesisStaleRuns: defineSchedule({
    cron: '*/10 * * * *',
    worker: (job, { get }) => get(SynthesisStaleRunSweepService).sweep(job),
    alertAfterWaitingMinutes: 30,
  }),
  // Every minute, because a Transcribe batch job takes about that long.
  feedbackPendingTranscription: defineSchedule({
    cron: '* * * * *',
    worker: (job, { get }) => get(PendingTranscriptionService).fanOut(job),
    alertAfterWaitingMinutes: 10,
  }),
  // :37 past every hour. Dev and prod only (gate in the worker). One job:
  // its Clerk calls share one rate budget (UsersService.sweepTestUsers).
  testUserSweep: defineSchedule({
    cron: '37 * * * *',
    worker: (job, { get }) => get(UsersService).sweepTestUsers(job.signal),
    alertAfterWaitingMinutes: 60,
    // Pages through every stale test user in Clerk, throttled.
    timeoutMinutes: 30,
  }),
  // The robocall pipeline (src/outreach/docs/robocall-payment.md § Schedules).
  // The minute offsets keep the CallHub- and Stripe-heavy sweeps off each
  // other and off the top of the hour: capture :02, reconcile :03, send :04,
  // fresh charge :05, stranded :06/:21/:36/:51, staging :07, hold recovery
  // :08, completion :09, CallHub cleanup :00, deferred cancel :01/:16/:31/:46,
  // hold-failure cancel and backlog alert :11/:26/:41/:56, overdue alert
  // :12/:27/:42/:57.
  //
  // Frequent enough that a draft authorized inside the lead window is picked
  // up well before its send.
  robocallStagingSweep: defineSchedule({
    cron: '7,17,27,37,47,57 * * * *',
    worker: (job, { get }) =>
      get(OutreachRobocallStagingService).sweepRobocallStaging(job),
    alertAfterWaitingMinutes: 30,
  }),
  // Dials real phones. One job per pass, not a fan-out: at most one robocall
  // dials at a time, and the pass decides that across every run.
  robocallSendSweep: defineSchedule({
    cron: '4,14,24,34,44,54 * * * *',
    worker: (_job, { get }) =>
      get(OutreachRobocallSendService).sweepRobocallSend(),
    alertAfterWaitingMinutes: 30,
    // A healthy pass is a few CallHub calls. Under the dialing stale window
    // (ROBOCALL_DIALING_STALE_MINUTES, 15), so the retry an expired pass gets
    // finds its `dialing` row not yet stale, rather than reverting it to
    // `authorized` while the hung pass is still starting the campaign.
    timeoutMinutes: 10,
  }),
  robocallCompletionSweep: defineSchedule({
    cron: '9,19,29,39,49,59 * * * *',
    worker: (job, { get }) =>
      get(OutreachRobocallCompletionService).sweepRobocallCompletion(job),
    alertAfterWaitingMinutes: 30,
  }),
  // Three minutes after completion records the count.
  robocallCaptureSweep: defineSchedule({
    cron: '2,12,22,32,42,52 * * * *',
    worker: (job, { get }) =>
      get(OutreachRobocallCaptureService).sweepCaptures(job),
    alertAfterWaitingMinutes: 30,
  }),
  robocallFreshChargeSweep: defineSchedule({
    cron: '5,15,25,35,45,55 * * * *',
    worker: (job, { get }) =>
      get(OutreachRobocallFreshChargeService).sweepFreshCharges(job),
    alertAfterWaitingMinutes: 30,
  }),
  robocallHoldRecoverySweep: defineSchedule({
    cron: '8,18,28,38,48,58 * * * *',
    worker: (job, { get }) =>
      get(OutreachRobocallHoldRecoveryService).sweepStaleHoldPending(job),
    alertAfterWaitingMinutes: 30,
  }),
  robocallHoldReconcileSweep: defineSchedule({
    cron: '3,13,23,33,43,53 * * * *',
    worker: (job, { get }) =>
      get(OutreachRobocallHoldReconcileService).sweepOrphanedHolds(job),
    alertAfterWaitingMinutes: 30,
  }),
  // 13:13 UTC: 8:13 AM Eastern in winter, 9:13 AM in summer. Daily is
  // plenty: a draft that enters the 3-day window is still days from its send.
  robocallDeferredHoldSweep: defineSchedule({
    cron: '13 13 * * *',
    worker: (job, { get }) =>
      get(OutreachRobocallDeferredHoldService).sweepDeferredHolds(job),
    alertAfterWaitingMinutes: 30,
  }),
  // Often, so a just-passed send deadline is cancelled and the candidate
  // told promptly.
  robocallDeferredCancelSweep: defineSchedule({
    cron: '1,16,31,46 * * * *',
    worker: (job, { get }) =>
      get(OutreachRobocallDeferredHoldService).sweepExpiredDeferred(job),
    alertAfterWaitingMinutes: 30,
  }),
  // 19:00 UTC: 2 PM Eastern in winter, 3 PM in summer.
  robocallHoldFailureReminderSweep: defineSchedule({
    cron: '0 19 * * *',
    worker: (job, { get }) =>
      get(OutreachRobocallHoldFailureService).sweepHoldFailureReminders(job),
    alertAfterWaitingMinutes: 30,
  }),
  robocallHoldFailureCancelSweep: defineSchedule({
    cron: '11,26,41,56 * * * *',
    worker: (job, { get }) =>
      get(OutreachRobocallHoldFailureService).sweepHoldFailureCancellations(
        job,
      ),
    alertAfterWaitingMinutes: 30,
  }),
  // A strand is rare and its money sits ~7 days before the auth expires, so
  // every 15 minutes is ample.
  robocallStrandedAuthorizedSweep: defineSchedule({
    cron: '6,21,36,51 * * * *',
    worker: (job, { get }) =>
      get(OutreachRobocallStrandedService).sweepStrandedAuthorized(job),
    alertAfterWaitingMinutes: 30,
  }),
  // Orphans are rare, so the cadence is not critical.
  robocallCallhubCleanupSweep: defineSchedule({
    cron: '0,10,20,30,40,50 * * * *',
    worker: (job, { get }) =>
      get(OutreachRobocallCallhubCleanupService).sweepOrphanedCampaigns(job),
    alertAfterWaitingMinutes: 30,
  }),
  // The two alerts make no CallHub or Stripe call and page once per run (a
  // dedupe CAS), so every 15 minutes is ample.
  robocallBacklogAlertSweep: defineSchedule({
    cron: '11,26,41,56 * * * *',
    worker: (_job, { get }) =>
      get(OutreachRobocallBacklogAlertService).sweepBacklogAlerts(),
    alertAfterWaitingMinutes: 30,
  }),
  robocallOverdueAlertSweep: defineSchedule({
    cron: '12,27,42,57 * * * *',
    worker: (_job, { get }) =>
      get(OutreachRobocallOverdueAlertService).sweepOverdueAlerts(),
    alertAfterWaitingMinutes: 30,
  }),
  // The Win P2P SMS money sweeps, every 15 minutes on minutes no other P2P
  // sweep uses. Each sends one job per hold (src/outreach/docs/services.md).
  p2pSmsCaptureSweep: defineSchedule({
    cron: '0,15,30,45 * * * *',
    worker: (job, { get }) =>
      get(OutreachP2pSmsCaptureService).sweepCaptures(job),
    alertAfterWaitingMinutes: 30,
  }),
  p2pSmsRefundingReconcileSweep: defineSchedule({
    cron: '2,17,32,47 * * * *',
    worker: (job, { get }) =>
      get(OutreachP2pSmsReconcileService).sweepStrandedRefunding(job),
    alertAfterWaitingMinutes: 30,
  }),
  p2pSmsDeniedReconcileSweep: defineSchedule({
    cron: '7,22,37,52 * * * *',
    worker: (job, { get }) =>
      get(OutreachP2pSmsReconcileService).sweepDeniedUnreleased(job),
    alertAfterWaitingMinutes: 30,
  }),
  p2pSmsStrandedAuthorizedReconcileSweep: defineSchedule({
    cron: '12,27,42,57 * * * *',
    worker: (job, { get }) =>
      get(OutreachP2pSmsReconcileService).sweepStrandedAuthorized(job),
    alertAfterWaitingMinutes: 30,
  }),
  // Every 15 minutes: builds stuck `building` for 20 minutes are re-queued
  // (a new p2pPhoneListBuild job) or failed past their attempt budget.
  p2pPhoneListBuildStaleSweep: defineSchedule({
    cron: '14,29,44,59 * * * *',
    worker: async (_job, { get }) => {
      await get(P2pPhoneListUploadService).sweepStaleBuilding()
    },
    alertAfterWaitingMinutes: 30,
  }),
  // Every 15 minutes, dev and prod only: lists whose browser poll stopped
  // are read from Peerly and stamped ready.
  p2pPhoneListFinishSweep: defineSchedule({
    cron: '8,23,38,53 * * * *',
    worker: (job, { get }) =>
      get(P2pPhoneListUploadService).sweepUnfinishedBuilds(job),
    alertAfterWaitingMinutes: 30,
  }),
  // Hourly, dev and prod only: Peerly reply and opt-out reports read into
  // contact interactions. Half an hour off the completion sweep so the two
  // Peerly pollers don't burst on the same minute.
  // Timed out well past a normal pass (the hourly lock it replaced gave a
  // pass 30 minutes): a timed-out run's retry can read a job a second time.
  outreachInboundSweep: defineSchedule({
    cron: '30 * * * *',
    worker: (job, { get }) =>
      get(OutreachInboundSweepService).sweepInboundEvents(job),
    alertAfterWaitingMinutes: 60,
    timeoutMinutes: 55,
  }),
  // Hourly, dev and prod only: Peerly's own opt-out flags, each job's report
  // read at most every six hours. No report starts after 20 minutes and none
  // runs past 5, so a pass is done well inside its timeout.
  outreachOptOutReconcile: defineSchedule({
    cron: '45 * * * *',
    worker: (job, { get }) =>
      get(OutreachInboundSweepService).reconcileOptOutFlags(job),
    alertAfterWaitingMinutes: 60,
    timeoutMinutes: 45,
  }),
  // Hourly: P2P outreach statuses moved forward from their Peerly jobs.
  outreachCompletionSweep: defineSchedule({
    cron: '0 * * * *',
    worker: (job, { get }) =>
      get(OutreachCompletionService).sweepOutreachCompletions(job),
    alertAfterWaitingMinutes: 60,
    timeoutMinutes: 30,
  }),
  // Every 15 minutes, dev and prod only: agent hand-offs with no replies 54
  // hours after their send are flagged to a person.
  outreachHandoffOverdueSweep: defineSchedule({
    cron: '8,23,38,53 * * * *',
    worker: async (_job, { get }) => {
      await get(OutreachTextHandoffService).sweepOverdue()
    },
    alertAfterWaitingMinutes: 30,
  }),
}

export type Schedules = typeof SCHEDULES
export type ScheduleName = keyof Schedules
