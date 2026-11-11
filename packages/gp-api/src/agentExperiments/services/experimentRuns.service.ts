import { BadGatewayException, Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { v7 as uuidv7 } from 'uuid'
import { SQS } from '@aws-sdk/client-sqs'
import {
  ExperimentRun,
  ExperimentRunStatus,
  Prisma,
} from '../../generated/prisma'
import { randomUUID } from 'crypto'
import { differenceInMinutes, isAfter } from 'date-fns'
import { AgentJobContracts } from '@/generated/agent-job-contracts'
import { isJsonObject } from '@/shared/util/objects.util'
import { NON_RESUMABLE_EXPERIMENT_TYPES } from '@/agentExperiments/experimentTypes'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { SlackChannel } from '@/vendors/slack/slackService.types'
import { isTestUser } from '@/users/util/users.util'
import { JobsService } from '@/jobs/jobs.service'
import type { JobRun } from '@/jobs/jobs.registry'

const sqs = new SQS({})

export type DispatchPriority = 'HIGH' | 'DEFAULT'

export type ExperimentRunDispatchInput<
  ExperimentType extends keyof AgentJobContracts,
> = {
  type: ExperimentType
  organizationSlug: string
  clerkUserId: string | undefined
  params: AgentJobContracts[ExperimentType]['Input']
  priority?: DispatchPriority
}

// Each resume is a full paid agent run (~$1). The slowest legitimate
// compliance_setup completion observed in prod used 5 resume attempts (a site
// awaiting DNS propagation); everything else completes within 1. Capping at 5
// bounds a stuck run to ~6 runs (~$6) instead of ~$48, and — because the agent
// otherwise tends to give up around attempt 7 with a silent terminal failure —
// ensures the exhaustion path (and its Slack alert) actually fires on a loop.
export const MAX_RESUME_ATTEMPTS = 5
// Drain the resumable backlog incrementally across ticks so a post-pause
// surge can't load an unbounded result set or overrun the 5-minute interval.
const RESUME_SWEEP_BATCH_SIZE = 100
// resumeRun's claim is followed by a successor or a release within a second
// or two, so a claim older than this was left by an attempt that died. Well
// past the 30 seconds ECS gives a stopping task.
const RESUME_CLAIM_STALE_MINUTES = 2

type ResumeRunInput = {
  runId: string
  organizationSlug: string
  experimentType: string
  params: unknown
  stage?: string | null
  resumeAttempts: number
  priority: string
}

@Injectable()
export class ExperimentRunsService extends createPrismaBase(
  MODELS.ExperimentRun,
) {
  constructor(
    private readonly slack: SlackService,
    private readonly jobs: JobsService,
  ) {
    super()
  }

  private cachedQueueUrl: string | undefined

  // The queue name is static per environment, so resolve the URL once and cache
  // it on the instance — a sweep re-dispatching N runs would otherwise issue N
  // GetQueueUrl calls.
  private async resolveQueueUrl(): Promise<string | undefined> {
    if (this.cachedQueueUrl) {
      return this.cachedQueueUrl
    }

    const queueName = process.env.AGENT_DISPATCH_QUEUE_NAME
    if (!queueName) {
      return
    }

    const { QueueUrl } = await sqs.getQueueUrl({ QueueName: queueName })
    this.cachedQueueUrl = QueueUrl

    return QueueUrl
  }

  private async enqueueDispatch(
    queueUrl: string,
    input: {
      runId: string
      organizationSlug: string
      experimentType: string
      clerkUserId: string | undefined
      params: unknown
      priority: DispatchPriority
    },
  ) {
    const messageBody = {
      run_id: input.runId,
      params: input.params,
      organization_slug: input.organizationSlug,
      experiment_type: input.experimentType,
      clerk_user_id: input.clerkUserId,
      priority: input.priority,
    }

    await sqs.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(messageBody),
      MessageGroupId: `agent-dispatch-${input.organizationSlug}`,
      MessageDeduplicationId: randomUUID(),
    })
  }

  private async createAndEnqueueRun(input: {
    experimentType: string
    organizationSlug: string
    clerkUserId: string | undefined
    params: Prisma.InputJsonValue
    priority?: DispatchPriority
    resumeAttempts?: number
    stage?: string | null
  }): Promise<ExperimentRun | undefined> {
    const queueUrl = await this.resolveQueueUrl()
    if (!queueUrl) {
      this.logger.warn(
        'No Queue Url found for agent dispatch, not configured for this environment',
      )
      return
    }
    const organization = await this.client.organization.findUnique({
      where: { slug: input.organizationSlug },
      select: {
        owner: { select: { email: true } },
        testModeCreatedAt: true,
      },
    })
    if (
      isTestUser({ email: organization?.owner.email ?? '' }) ||
      organization?.testModeCreatedAt
    ) {
      this.logger.info(
        {
          organizationSlug: input.organizationSlug,
          experimentType: input.experimentType,
        },
        'Skipping agent dispatch for test-user org',
      )
      return
    }
    const runId = uuidv7()
    const result = await this.model.create({
      data: {
        runId,
        experimentType: input.experimentType,
        organizationSlug: input.organizationSlug,
        status: ExperimentRunStatus.QUEUED,
        priority: input.priority ?? 'DEFAULT',
        params: input.params,
        resumeAttempts: input.resumeAttempts ?? 0,
        stage: input.stage ?? null,
      },
    })
    try {
      await this.enqueueDispatch(queueUrl, {
        runId,
        organizationSlug: input.organizationSlug,
        experimentType: input.experimentType,
        clerkUserId: input.clerkUserId,
        params: input.params,
        priority: input.priority ?? 'DEFAULT',
      })
    } catch (error) {
      this.logger.error(
        {
          error,
          runId,
          experimentType: input.experimentType,
          organizationSlug: input.organizationSlug,
        },
        'Failed to send dispatch message to SQS',
      )
      try {
        await this.model.update({
          where: { runId },
          data: {
            status: ExperimentRunStatus.FAILED,
            error: 'SQS dispatch failed',
          },
        })
      } catch (updateError) {
        this.logger.error(
          { updateError, runId },
          'Failed to mark run FAILED after SQS dispatch error — row stuck QUEUED with no automatic reclaim',
        )
      }
      throw new BadGatewayException(
        'Failed to dispatch experiment. Please try again.',
      )
    }
    this.logger.info(
      {
        runId,
        experimentType: input.experimentType,
        organizationSlug: input.organizationSlug,
      },
      'Experiment dispatched',
    )
    return result
  }

  async dispatchRun<ExperimentType extends keyof AgentJobContracts>(
    input: ExperimentRunDispatchInput<ExperimentType>,
  ) {
    return this.createAndEnqueueRun({
      experimentType: input.type,
      organizationSlug: input.organizationSlug,
      clerkUserId: input.clerkUserId,
      priority: input.priority ?? 'DEFAULT',
      // AgentJobContracts inputs are JSON-serializable objects validated by Zod;
      // the assertion bridges the structural index-signature gap that InputJsonObject
      // requires but the generated contract types don't declare.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      params: input.params as Prisma.InputJsonObject,
    })
  }

  async resumeRun(run: ResumeRunInput) {
    const clerkUserId =
      isJsonObject(run.params) &&
      typeof run.params['clerk_user_id'] === 'string'
        ? run.params['clerk_user_id']
        : null

    if (!clerkUserId) {
      this.logger.error(
        { runId: run.runId },
        'run params carry no clerk_user_id; cannot resume without actor identity',
      )
      await this.model.updateMany({
        where: {
          runId: run.runId,
          status: ExperimentRunStatus.AWAITING_RESUME,
        },
        data: {
          status: ExperimentRunStatus.FAILED,
          error: 'Cannot resume: run params carry no clerk_user_id',
        },
      })
      return
    }

    const claimed = await this.model.updateMany({
      where: {
        runId: run.runId,
        status: ExperimentRunStatus.AWAITING_RESUME,
        resumeScheduledFor: { not: null },
      },
      data: { resumeScheduledFor: null },
    })

    if (claimed.count === 0) {
      return
    }

    const resumeParams = {
      ...(isJsonObject(run.params) ? run.params : {}),
      trigger: 'recovery_resume',
    } as Prisma.InputJsonObject

    let dispatched: ExperimentRun | undefined
    try {
      dispatched = await this.createAndEnqueueRun({
        experimentType: run.experimentType,
        organizationSlug: run.organizationSlug,
        clerkUserId,
        // Coerce the stored string back to the union; anything other than the
        // exact 'HIGH' marker is treated as DEFAULT.
        priority: run.priority === 'HIGH' ? 'HIGH' : 'DEFAULT',
        params: resumeParams,
        resumeAttempts: run.resumeAttempts + 1,
        stage: run.stage,
      })
    } catch (error) {
      this.logger.error(
        { error, runId: run.runId },
        'Failed to dispatch resumed run',
      )
      dispatched = undefined
    }

    if (!dispatched) {
      // Dispatch threw, or no queue is configured (preview env) so no successor
      // was created. Release the claim so the row returns to the sweep instead
      // of being orphaned or falsely marked superseded — but still increment
      // resumeAttempts so MAX_RESUME_ATTEMPTS eventually terminates it (e.g. a
      // prolonged SQS outage would otherwise re-dispatch forever). Wrap the
      // release so a transient DB error here is logged rather than left stuck.
      try {
        await this.model.updateMany({
          where: {
            runId: run.runId,
            status: ExperimentRunStatus.AWAITING_RESUME,
          },
          data: {
            resumeScheduledFor: new Date(),
            resumeAttempts: { increment: 1 },
          },
        })
      } catch (releaseError) {
        this.logger.error(
          { releaseError, runId: run.runId },
          'Failed to release resume claim — row stuck AWAITING_RESUME with no schedule',
        )
      }
      return
    }

    // A successor run was created; terminalize the old row so it can't linger
    // forever as a non-terminal orphan (the resume sweep ignores a null
    // resumeScheduledFor, and the stale sweep only touches RUNNING). SUPERSEDED
    // (not FAILED): the predecessor did real work (e.g. bought the domain +
    // published the site) and handed off to its successor — it is not an error,
    // so the admin renders it as a benign "Part 1 completed", not a red failure.
    try {
      await this.model.updateMany({
        where: {
          runId: run.runId,
          status: ExperimentRunStatus.AWAITING_RESUME,
        },
        data: {
          status: ExperimentRunStatus.SUPERSEDED,
          error: 'Superseded by resumed run',
        },
      })
    } catch (supersedeError) {
      this.logger.error(
        { supersedeError, runId: run.runId },
        'Failed to terminalize superseded run — left as AWAITING_RESUME orphan',
      )
    }
  }

  // The experimentRunResumeSweep schedule's worker
  // (src/jobs/jobs.registry.ts). The key pins each job to its run and attempt,
  // so a sweep that finds a run whose job is still queued sends nothing new.
  async sweepResumableRuns(): Promise<void> {
    const due = await this.model.findMany({
      where: {
        status: ExperimentRunStatus.AWAITING_RESUME,
        resumeScheduledFor: { lte: new Date() },
        // Defense-in-depth: even a pre-existing parked briefing/schedule row
        // (there are none today) must never be resumed.
        experimentType: { notIn: [...NON_RESUMABLE_EXPERIMENT_TYPES] },
      },
      select: { runId: true, resumeAttempts: true },
      orderBy: { resumeScheduledFor: Prisma.SortOrder.asc },
      take: RESUME_SWEEP_BATCH_SIZE,
    })

    await this.jobs.sendMany(
      'experimentRunResume',
      due.map((run) => ({
        data: { runId: run.runId },
        key: `${run.runId}:${run.resumeAttempts}`,
      })),
    )
  }

  // The experimentRunResume job's worker. Re-reads the row, so a run that was
  // resumed, superseded or cancelled since the sweep found it is left alone.
  async resumeDueRun(job: JobRun<{ runId: string }>): Promise<void> {
    const run = await this.model.findFirst({
      where: {
        runId: job.data.runId,
        status: ExperimentRunStatus.AWAITING_RESUME,
        experimentType: { notIn: [...NON_RESUMABLE_EXPERIMENT_TYPES] },
      },
    })
    if (!run) return
    if (run.resumeScheduledFor && isAfter(run.resumeScheduledFor, new Date())) {
      return
    }
    if (job.signal.aborted) {
      throw new Error('Shutting down before claiming the resume')
    }

    // A cleared resumeScheduledFor is resumeRun's claim. Seen here it means
    // an earlier attempt of this job died between the claim and its successor
    // or release, since the sweep only sends due runs. Each resume is a paid
    // run, so dispatch again only when that attempt created no successor.
    if (!run.resumeScheduledFor) {
      if (
        differenceInMinutes(new Date(), run.updatedAt) <
        RESUME_CLAIM_STALE_MINUTES
      ) {
        throw new Error(
          'Resume claim is still fresh; an earlier attempt may be running',
        )
      }
      const successor = await this.model.findFirst({
        where: {
          organizationSlug: run.organizationSlug,
          experimentType: run.experimentType,
          resumeAttempts: run.resumeAttempts + 1,
          createdAt: { gt: run.createdAt },
        },
      })
      if (successor) {
        await this.model.updateMany({
          where: {
            runId: run.runId,
            status: ExperimentRunStatus.AWAITING_RESUME,
            resumeScheduledFor: null,
          },
          data: {
            status: ExperimentRunStatus.SUPERSEDED,
            error: 'Superseded by resumed run',
          },
        })
        return
      }
      const released = await this.model.updateMany({
        where: {
          runId: run.runId,
          status: ExperimentRunStatus.AWAITING_RESUME,
          resumeScheduledFor: null,
        },
        data: { resumeScheduledFor: new Date() },
      })
      if (released.count === 0) return
    }

    if (run.resumeAttempts < MAX_RESUME_ATTEMPTS) {
      await this.resumeRun(run)
      return
    }

    const { count } = await this.model.updateMany({
      where: {
        runId: run.runId,
        status: ExperimentRunStatus.AWAITING_RESUME,
      },
      data: {
        status: ExperimentRunStatus.FAILED,
        error:
          `Exceeded max resume attempts (${run.resumeAttempts}) ` +
          `at stage: ${run.stage ?? 'unknown'}`,
      },
    })
    // Only the attempt whose update actually terminalized the row (count > 0)
    // alerts, so a retry doesn't re-announce the failure. Without this the
    // run dies silently after exhausting its resume budget — no log, no
    // Slack, no human in the loop.
    if (count > 0) {
      await this.alertMaxResumeExhausted(run)
    }
  }

  // Resume-driven runs are compliance_setup today, so a run that burns through
  // every attempt needs a human on the 10DLC compliance channel. Best-effort:
  // a Slack failure must not abort the sweep mid-batch.
  private async alertMaxResumeExhausted(run: ExperimentRun) {
    try {
      await this.slack.errorMessage(
        {
          message:
            `${run.experimentType} run exhausted ${MAX_RESUME_ATTEMPTS} ` +
            `resume attempts at stage "${run.stage ?? 'unknown'}" and was ` +
            `marked FAILED — needs manual investigation. ` +
            `org=${run.organizationSlug} runId=${run.runId}`,
        },
        SlackChannel.bot10DlcCompliance,
      )
    } catch (error) {
      this.logger.error(
        { error, runId: run.runId },
        'failed to post max-resume-exhausted Slack alert',
      )
    }
  }

  // The scheduler emits `started` when it actually launches the Fargate task.
  // Guarded on QUEUED so it is idempotent: a RUNNING/AWAITING_RESUME row is left
  // untouched, and only a still-queued run advances to RUNNING.
  markStarted(runId: string) {
    return this.model.updateMany({
      where: { runId, status: ExperimentRunStatus.QUEUED },
      data: { status: ExperimentRunStatus.RUNNING },
    })
  }

  // Flip a run to FAILED after the fact, e.g. when a result arrived but the
  // caller couldn't load/persist its artifact. Truncate the error to match the
  // queue-consumer's column bound.
  markFailed(runId: string, error: string) {
    return this.model.update({
      where: { runId },
      data: { status: ExperimentRunStatus.FAILED, error: error.slice(0, 1000) },
    })
  }
}
