import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { mockClient } from 'aws-sdk-client-mock'
import { addMinutes, subMinutes } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentRunStatus, Prisma } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { SlackChannel } from '@/vendors/slack/slackService.types'
import {
  ExperimentRunsService,
  MAX_RESUME_ATTEMPTS,
} from './experimentRuns.service'

const service = useTestService({ jobs: true })
const sqsMock = mockClient(SQSClient)

const ORG_SLUG = 'resume-org'

const seedRun = (
  overrides: Partial<Prisma.ExperimentRunUncheckedCreateInput> = {},
) =>
  service.prisma.experimentRun.create({
    data: {
      organizationSlug: ORG_SLUG,
      experimentType: 'compliance_setup',
      status: ExperimentRunStatus.AWAITING_RESUME,
      params: { trigger: 'initial', clerk_user_id: 'user_resume' },
      stage: 'domain_registration',
      resumeAttempts: 0,
      resumeScheduledFor: subMinutes(new Date(), 1),
      ...overrides,
    },
  })

const reload = (runId: string) =>
  service.prisma.experimentRun.findUniqueOrThrow({ where: { runId } })

const sentBodies = () =>
  sqsMock
    .commandCalls(SendMessageCommand)
    .map(
      (call) =>
        JSON.parse(call.args[0].input.MessageBody ?? '{}') as Record<
          string,
          unknown
        >,
    )

describe('experimentRunResumeSweep', () => {
  beforeEach(async () => {
    sqsMock.reset()
    sqsMock.onAnyCommand().resolves({
      QueueUrl: 'https://sqs.us-west-2.amazonaws.com/123/agent-dispatch.fifo',
      MessageId: 'm-1',
    })
    vi.stubEnv('AGENT_DISPATCH_QUEUE_NAME', 'agent-dispatch.fifo')
    await service.prisma.organization.create({
      data: { slug: ORG_SLUG, ownerId: service.user.id },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('dispatches a successor for a due run and supersedes the old row', async () => {
    const run = await seedRun({ priority: 'HIGH', resumeAttempts: 1 })

    await service.jobs.runSchedule('experimentRunResumeSweep')

    expect((await reload(run.runId)).status).toBe(
      ExperimentRunStatus.SUPERSEDED,
    )
    const successor = await service.prisma.experimentRun.findFirstOrThrow({
      where: { runId: { not: run.runId } },
    })
    expect(successor).toMatchObject({
      status: ExperimentRunStatus.QUEUED,
      priority: 'HIGH',
      resumeAttempts: 2,
      stage: 'domain_registration',
    })
    expect(sentBodies()).toEqual([
      expect.objectContaining({
        run_id: successor.runId,
        organization_slug: ORG_SLUG,
        clerk_user_id: 'user_resume',
        priority: 'HIGH',
        params: expect.objectContaining({ trigger: 'recovery_resume' }),
      }),
    ])
  })

  it('leaves runs that are not due, not resumable or not awaiting resume', async () => {
    const notDue = await seedRun({
      resumeScheduledFor: addMinutes(new Date(), 30),
    })
    const briefing = await seedRun({ experimentType: 'meeting_briefing' })
    const running = await seedRun({ status: ExperimentRunStatus.RUNNING })

    await service.jobs.runSchedule('experimentRunResumeSweep')

    expect(sentBodies()).toEqual([])
    expect((await reload(notDue.runId)).status).toBe(
      ExperimentRunStatus.AWAITING_RESUME,
    )
    expect((await reload(briefing.runId)).status).toBe(
      ExperimentRunStatus.AWAITING_RESUME,
    )
    expect((await reload(running.runId)).status).toBe(
      ExperimentRunStatus.RUNNING,
    )
  })

  it('fails a run at the attempt cap and alerts Slack once', async () => {
    const errorMessage = vi
      .spyOn(service.app.get(SlackService), 'errorMessage')
      .mockResolvedValue(undefined)
    const run = await seedRun({ resumeAttempts: MAX_RESUME_ATTEMPTS })

    await service.jobs.runSchedule('experimentRunResumeSweep')

    const failed = await reload(run.runId)
    expect(failed.status).toBe(ExperimentRunStatus.FAILED)
    expect(failed.error).toContain(String(MAX_RESUME_ATTEMPTS))
    expect(sentBodies()).toEqual([])
    expect(errorMessage).toHaveBeenCalledTimes(1)
    expect(errorMessage).toHaveBeenCalledWith(
      { message: expect.stringContaining(run.runId) },
      SlackChannel.bot10DlcCompliance,
    )
  })

  it('fails a run whose params carry no clerk_user_id without dispatching', async () => {
    const run = await seedRun({ params: { trigger: 'initial' } })

    await service.jobs.runSchedule('experimentRunResumeSweep')

    expect((await reload(run.runId)).status).toBe(ExperimentRunStatus.FAILED)
    expect(sentBodies()).toEqual([])
  })

  it('retries and dead-letters one failing run without stopping the rest', async () => {
    const failing = await seedRun()
    const ok = await seedRun()
    const runs = service.app.get(ExperimentRunsService)
    const resumeRun = runs.resumeRun.bind(runs)
    vi.spyOn(runs, 'resumeRun').mockImplementation(async (run) => {
      if (run.runId === failing.runId) throw new Error('db down')
      return resumeRun(run)
    })

    const { deadLetters } = await service.jobs.runSchedule(
      'experimentRunResumeSweep',
      { allowDeadLetters: true },
    )

    expect(deadLetters).toEqual([
      {
        name: 'experimentRunResume',
        data: { runId: failing.runId },
        error: 'db down',
      },
    ])
    expect((await reload(ok.runId)).status).toBe(ExperimentRunStatus.SUPERSEDED)
    expect((await reload(failing.runId)).status).toBe(
      ExperimentRunStatus.AWAITING_RESUME,
    )
  })

  describe('when an earlier attempt died after claiming the run', () => {
    // resumeRun's claim, then the task dies before a successor or release.
    const claimThenDie = (claimedAt?: Date) => {
      const runs = service.app.get(ExperimentRunsService)
      const resumeRun = runs.resumeRun.bind(runs)
      return vi
        .spyOn(runs, 'resumeRun')
        .mockImplementationOnce(async (run) => {
          await service.prisma.experimentRun.updateMany({
            where: { runId: run.runId },
            data: {
              resumeScheduledFor: null,
              ...(claimedAt ? { updatedAt: claimedAt } : {}),
            },
          })
          throw new Error('task died')
        })
        .mockImplementation((run) => resumeRun(run))
    }

    it('dispatches on the retry when no successor was created', async () => {
      const run = await seedRun()
      claimThenDie(subMinutes(new Date(), 10))

      await service.jobs.runSchedule('experimentRunResumeSweep')

      expect((await reload(run.runId)).status).toBe(
        ExperimentRunStatus.SUPERSEDED,
      )
      expect(sentBodies()).toHaveLength(1)
    })

    it('supersedes without a second dispatch when a successor exists', async () => {
      const run = await seedRun()
      const runs = service.app.get(ExperimentRunsService)
      vi.spyOn(runs, 'resumeRun').mockImplementationOnce(async (claimed) => {
        await service.prisma.experimentRun.updateMany({
          where: { runId: claimed.runId },
          data: {
            resumeScheduledFor: null,
            updatedAt: subMinutes(new Date(), 10),
          },
        })
        await service.prisma.experimentRun.create({
          data: {
            organizationSlug: ORG_SLUG,
            experimentType: 'compliance_setup',
            status: ExperimentRunStatus.QUEUED,
            resumeAttempts: claimed.resumeAttempts + 1,
          },
        })
        throw new Error('task died')
      })

      await service.jobs.runSchedule('experimentRunResumeSweep')

      expect((await reload(run.runId)).status).toBe(
        ExperimentRunStatus.SUPERSEDED,
      )
      expect(sentBodies()).toEqual([])
    })

    it('never dispatches while the claim is fresh, and dead-letters', async () => {
      const run = await seedRun({ updatedAt: subMinutes(new Date(), 30) })
      claimThenDie()

      const { deadLetters } = await service.jobs.runSchedule(
        'experimentRunResumeSweep',
        { allowDeadLetters: true },
      )

      expect(deadLetters).toEqual([
        {
          name: 'experimentRunResume',
          data: { runId: run.runId },
          error:
            'Resume claim is still fresh; an earlier attempt may be running',
        },
      ])
      expect(sentBodies()).toEqual([])
      expect((await reload(run.runId)).status).toBe(
        ExperimentRunStatus.AWAITING_RESUME,
      )
    })
  })
})
