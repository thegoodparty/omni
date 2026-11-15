import { Injectable } from '@nestjs/common'
import { addMinutes, isValid, parseISO } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { NON_RESUMABLE_EXPERIMENT_TYPES } from '@/agentExperiments/experimentTypes'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { CampaignTrackerTasksService } from '@/campaigns/campaignTracker/services/campaignTrackerTasks.service'
import { CampaignStrategyService } from '@/campaignStrategy/services/campaignStrategy.service'
import { CommunityIssueService } from '@/communityIssues/services/communityIssue.service'
import { ExperimentRunStatus } from '@/generated/prisma'
import { MeetingBriefingsService } from '@/meetings/services/meetingBriefings.service'
import { OrdinanceCodePersistService } from '@/ordinances/services/ordinanceCodePersist.service'
import { RaceOpponentPersistService } from '@/raceOpponent/services/raceOpponentPersist.service'
import { RaceOpponentResearchPersistService } from '@/raceOpponent/services/raceOpponentResearchPersist.service'
import { isJsonObject } from '@/shared/util/objects.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import type { AgentExperimentResultData } from '../queue.types'

const TERMINAL_STATUSES: readonly ExperimentRunStatus[] = [
  ExperimentRunStatus.COMPLETED,
  ExperimentRunStatus.FAILED,
  ExperimentRunStatus.SUPERSEDED,
]

@Injectable()
export class AgentExperimentResultService {
  constructor(
    private readonly s3Service: S3Service,
    private readonly experimentRunsService: ExperimentRunsService,
    private readonly meetingBriefings: MeetingBriefingsService,
    private readonly communityIssue: CommunityIssueService,
    private readonly campaignStrategy: CampaignStrategyService,
    private readonly campaignTrackerTasks: CampaignTrackerTasksService,
    private readonly raceOpponent: RaceOpponentPersistService,
    private readonly raceOpponentResearch: RaceOpponentResearchPersistService,
    private readonly ordinanceCodePersist: OrdinanceCodePersistService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AgentExperimentResultService.name)
  }

  // Reads the agent artifact to decide terminal vs resumable status. The result
  // message only says success/failed; data_quality/next_action live in the S3
  // artifact. Falls back to COMPLETED on any read/parse failure so a transient
  // S3 miss never strands a run.
  private async resolveSuccessPatch(
    data: AgentExperimentResultData,
    experimentType: string,
  ): Promise<{
    status: ExperimentRunStatus
    stage: string | null
    dataQuality: string | null
    resumeScheduledFor: Date | null
  }> {
    const base = {
      status: ExperimentRunStatus.COMPLETED,
      stage: null as string | null,
      dataQuality: null as string | null,
      resumeScheduledFor: null as Date | null,
    }
    if (!data.artifactBucket || !data.artifactKey) return base
    let artifact: Record<string, unknown>
    try {
      const raw = await this.s3Service.getFile(
        data.artifactBucket,
        data.artifactKey,
      )
      if (!raw) return base
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      artifact = JSON.parse(raw) as Record<string, unknown>
    } catch (error) {
      this.logger.warn(
        { error, runId: data.runId },
        'could not read artifact; defaulting to COMPLETED',
      )
      return base
    }

    const stage = typeof artifact.stage === 'string' ? artifact.stage : null
    const dq = artifact.data_quality
    const overall =
      isJsonObject(dq) && typeof dq.overall === 'string' ? dq.overall : null
    const nextAction = artifact.next_action
    const scheduledForRaw =
      isJsonObject(nextAction) &&
      typeof nextAction.scheduled_for === 'string' &&
      nextAction.scheduled_for !== ''
        ? nextAction.scheduled_for
        : null
    const parsedScheduledFor = scheduledForRaw
      ? parseISO(scheduledForRaw)
      : null
    const scheduledFor =
      parsedScheduledFor && isValid(parsedScheduledFor)
        ? parsedScheduledFor
        : null

    // The resume loop exists for compliance_setup recovery. Briefings/schedules
    // must never auto-resume on a partial; they fall through to COMPLETED (where
    // onExperimentRunCompleted skips writing a MeetingBriefing row for the
    // awaiting_agenda placeholder, leaving the next cron to retry).
    const resumable = !(
      NON_RESUMABLE_EXPERIMENT_TYPES as readonly string[]
    ).includes(experimentType)
    if (overall === 'partial' && resumable) {
      return {
        status: ExperimentRunStatus.AWAITING_RESUME,
        stage,
        dataQuality: overall,
        resumeScheduledFor: scheduledFor ?? addMinutes(new Date(), 5),
      }
    }
    if (overall === 'failed' || stage === 'failed') {
      return {
        ...base,
        status: ExperimentRunStatus.FAILED,
        stage,
        dataQuality: overall,
      }
    }
    return { ...base, stage, dataQuality: overall }
  }

  async handleAgentExperimentResult(
    data: AgentExperimentResultData,
  ): Promise<void> {
    const run = await this.experimentRunsService.findUnique({
      where: { runId: data.runId },
    })

    if (!run) {
      this.logger.error({ data }, 'Experiment run not found')
      return
    }

    if (TERMINAL_STATUSES.includes(run.status)) {
      this.logger.info(
        { runId: data.runId, status: run.status },
        'Experiment run already terminal, skipping',
      )
      return
    }

    // The scheduler emits `started` when it actually launches the Fargate task.
    // Move QUEUED -> RUNNING so the 45-minute stale sweep measures execution
    // time, not queue-wait time. Idempotent: a RUNNING/AWAITING_RESUME row is
    // left untouched.
    if (data.status === 'started') {
      await this.experimentRunsService.markStarted(data.runId)
      return
    }

    const successPatch =
      data.status === 'success'
        ? await this.resolveSuccessPatch(data, run.experimentType)
        : null

    const updatedRun = await this.experimentRunsService.optimisticLockingUpdate(
      { where: { runId: data.runId } },
      async (currentRun) => {
        if (TERMINAL_STATUSES.includes(currentRun.status)) {
          this.logger.info(
            { runId: data.runId },
            'Experiment run already terminal, skipping',
          )
          throw new Error('Experiment run already terminal')
        }
        return {
          status: successPatch
            ? successPatch.status
            : ExperimentRunStatus.FAILED,
          stage: successPatch?.stage ?? null,
          dataQuality: successPatch?.dataQuality ?? null,
          resumeScheduledFor: successPatch?.resumeScheduledFor ?? null,
          artifactKey: data.artifactKey ?? null,
          artifactBucket: data.artifactBucket ?? null,
          durationSeconds: data.durationSeconds ?? null,
          costUsd: data.costUsd ?? null,
          error: data.error?.slice(0, 1000) ?? null,
        }
      },
    )

    this.logger.info(
      { updatedRun, data },
      'Updated experiment run from queue event',
    )

    if (updatedRun.status === ExperimentRunStatus.COMPLETED) {
      await this.meetingBriefings
        .onExperimentRunCompleted(updatedRun)
        .catch((err: unknown) =>
          this.logger.error(
            { err, runId: updatedRun.runId },
            'onExperimentRunCompleted failed after run update',
          ),
        )
      await this.communityIssue
        .onExperimentRunCompleted(updatedRun)
        .catch((err: unknown) =>
          this.logger.error(
            { err, runId: updatedRun.runId },
            'communityIssue.onExperimentRunCompleted failed after run update',
          ),
        )
    }

    // Let a persistence failure propagate instead of swallowing it, so the
    // failure surfaces (a failed job attempt in the logs) rather than
    // silently completing a COMPLETED run that never got its section
    // persisted. This is for visibility, not retry: onExperimentRunCompleted
    // already calls markFailed before it rethrows, so on the retry the status
    // guard above (terminal-status check) completes the job. The user-facing
    // 'failed' state comes from
    // markFailed (or, if markFailed itself faults, the isStuck grace-window
    // backstop), not from the retry. onExperimentRunCompleted is a no-op for
    // non-campaign-strategy runs, so this only throws on a real persist failure.
    await this.campaignStrategy.onExperimentRunCompleted(updatedRun)
    await this.campaignTrackerTasks.onExperimentRunCompleted(updatedRun)

    // Same contract as campaignStrategy above: markFailed-then-throw on a
    // persist fault, no-op for other experiment types, and the persist is an
    // idempotent replace so a retry is safe.
    await this.raceOpponent.onExperimentRunCompleted(updatedRun)

    // Self-research persists on COMPLETED and flips the research row to failed
    // on FAILED, so it is called for both terminal states (not just COMPLETED).
    // Same markFailed-then-throw + idempotent-replace contract as above.
    await this.raceOpponentResearch.onExperimentRunCompleted(updatedRun)

    // Same contract again: markFailed-then-throw on a persist fault, no-op for
    // other experiment types, idempotent under a retry.
    await this.ordinanceCodePersist.onExperimentRunCompleted(updatedRun)
  }
}
