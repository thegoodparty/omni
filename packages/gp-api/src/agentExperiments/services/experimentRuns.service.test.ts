import {
  GetQueueUrlCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs'
import { BadGatewayException } from '@nestjs/common'
import { ExperimentRunStatus } from '../../generated/prisma'
import { mockClient } from 'aws-sdk-client-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import {
  ExperimentRunsService,
  MAX_RESUME_ATTEMPTS,
} from './experimentRuns.service'

const sqsMock = mockClient(SQSClient)
const RESOLVED_URL =
  'https://sqs.us-west-2.amazonaws.com/123/agent-dispatch-dev.fifo'

const requireFirst = <T>(items: T[]): T => {
  const [first] = items
  if (first === undefined) throw new Error('expected at least one item')
  return first
}

describe('ExperimentRunsService', () => {
  let service: ExperimentRunsService
  let mockModel: {
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
  }
  let mockSlack: { errorMessage: ReturnType<typeof vi.fn> }
  let campaignFindUnique: ReturnType<typeof vi.fn>
  const logger = createMockLogger()

  beforeEach(() => {
    sqsMock.reset()
    vi.clearAllMocks()
    process.env.AGENT_DISPATCH_QUEUE_NAME = 'agent-dispatch-dev.fifo'
    sqsMock.on(GetQueueUrlCommand).resolves({ QueueUrl: RESOLVED_URL })

    mockModel = {
      create: vi.fn().mockImplementation(async ({ data }) => data),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    }

    mockSlack = { errorMessage: vi.fn().mockResolvedValue(undefined) }
    service = new ExperimentRunsService(
      mockSlack as unknown as ConstructorParameters<
        typeof ExperimentRunsService
      >[0],
    )
    Object.defineProperty(service, 'model', {
      get: () => mockModel,
      configurable: true,
    })
    Object.defineProperty(service, 'logger', {
      get: () => logger,
      configurable: true,
    })
    campaignFindUnique = vi.fn().mockResolvedValue(null)
    Object.defineProperty(service, '_prisma', {
      value: { campaign: { findUnique: campaignFindUnique } },
      configurable: true,
    })
  })

  afterEach(() => {
    delete process.env.AGENT_DISPATCH_QUEUE_NAME
  })

  describe('dispatchRun', () => {
    it('skips dispatch (no row, no SQS) for a test-user campaign', async () => {
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' })
      campaignFindUnique.mockResolvedValue({
        user: { email: 'jane@test.goodparty.org' },
      })

      const result = await service.dispatchRun({
        type: 'district_issue_pulse',
        organizationSlug: 'org-1',
        clerkUserId: 'user_test_dispatch',
        params: {
          state: 'CA',
          city: 'San Francisco',
          l2DistrictType: 'city',
          l2DistrictName: 'San Francisco',
        },
      })

      expect(campaignFindUnique).toHaveBeenCalledWith({
        where: { organizationSlug: 'org-1' },
        select: { user: { select: { email: true } } },
      })
      expect(result).toBeUndefined()
      expect(mockModel.create).not.toHaveBeenCalled()
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0)
    })

    it('creates a QUEUED row and sends an SQS dispatch message', async () => {
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' })

      const result = await service.dispatchRun({
        type: 'district_issue_pulse',
        organizationSlug: 'org-1',
        clerkUserId: 'user_test_dispatch',
        params: {
          state: 'CA',
          city: 'San Francisco',
          l2DistrictType: 'city',
          l2DistrictName: 'San Francisco',
        },
      })

      expect(mockModel.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          runId: expect.any(String),
          experimentType: 'district_issue_pulse',
          organizationSlug: 'org-1',
          status: ExperimentRunStatus.QUEUED,
          params: {
            state: 'CA',
            city: 'San Francisco',
            l2DistrictType: 'city',
            l2DistrictName: 'San Francisco',
          },
        }),
      })

      const call = requireFirst(sqsMock.commandCalls(SendMessageCommand))
      expect(call).toBeDefined()
      const input = call.args[0].input
      expect(input.QueueUrl).toBe(RESOLVED_URL)
      expect(input.MessageGroupId).toBe('agent-dispatch-org-1')
      expect(input.MessageDeduplicationId).toEqual(expect.any(String))
      const body = JSON.parse(input.MessageBody as string) as Record<
        string,
        unknown
      >
      expect(body).toMatchObject({
        params: {
          state: 'CA',
          city: 'San Francisco',
          l2DistrictType: 'city',
          l2DistrictName: 'San Francisco',
        },
        organization_slug: 'org-1',
        experiment_type: 'district_issue_pulse',
        run_id: expect.any(String),
      })

      expect(result).toMatchObject({
        runId: expect.any(String),
        experimentType: 'district_issue_pulse',
        organizationSlug: 'org-1',
        status: ExperimentRunStatus.QUEUED,
      })
    })

    it('writes the same run_id to the DB row and the SQS message body', async () => {
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' })

      await service.dispatchRun({
        type: 'district_issue_pulse',
        organizationSlug: 'org-1',
        clerkUserId: 'user_test_dispatch',
        params: {
          state: 'CA',
          city: 'San Francisco',
          l2DistrictType: 'city',
          l2DistrictName: 'San Francisco',
        },
      })

      const dbRunId = mockModel.create.mock.calls[0]?.[0].data.runId as string
      const call = requireFirst(sqsMock.commandCalls(SendMessageCommand))
      const body = JSON.parse(call.args[0].input.MessageBody as string) as {
        run_id: string
        clerk_user_id: string
      }
      expect(body.run_id).toBe(dbRunId)
      expect(body.clerk_user_id).toBe('user_test_dispatch')
    })

    it('namespaces FIFO group per organization so runs for one org serialize', async () => {
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' })

      await service.dispatchRun({
        type: 'district_issue_pulse',
        organizationSlug: 'org-alpha',
        clerkUserId: 'user_test_dispatch',
        params: {
          state: 'CA',
          city: 'San Francisco',
          l2DistrictType: 'city',
          l2DistrictName: 'San Francisco',
        },
      })
      await service.dispatchRun({
        type: 'district_issue_pulse',
        organizationSlug: 'org-beta',
        clerkUserId: 'user_test_dispatch',
        params: {
          state: 'CA',
          city: 'San Francisco',
          l2DistrictType: 'city',
          l2DistrictName: 'San Francisco',
        },
      })

      const calls = sqsMock.commandCalls(SendMessageCommand)
      expect(calls[0]?.args[0].input.MessageGroupId).toBe(
        'agent-dispatch-org-alpha',
      )
      expect(calls[1]?.args[0].input.MessageGroupId).toBe(
        'agent-dispatch-org-beta',
      )
    })

    it('flips the row to FAILED and throws BadGateway when SQS send fails', async () => {
      sqsMock.on(SendMessageCommand).rejects(new Error('SQS unavailable'))

      await expect(
        service.dispatchRun({
          type: 'district_issue_pulse',
          organizationSlug: 'org-1',
          clerkUserId: 'user_test_dispatch',
          params: {
            state: 'CA',
            city: 'San Francisco',
            l2DistrictType: 'city',
            l2DistrictName: 'San Francisco',
          },
        }),
      ).rejects.toThrow(BadGatewayException)

      expect(mockModel.update).toHaveBeenCalledWith({
        where: { runId: expect.any(String) },
        data: { status: 'FAILED', error: 'SQS dispatch failed' },
      })
      expect(logger.error).toHaveBeenCalled()
    })

    it('still throws BadGateway (not the update error) when the compensating FAILED update also throws', async () => {
      sqsMock.on(SendMessageCommand).rejects(new Error('SQS unavailable'))
      mockModel.update.mockRejectedValue(new Error('db pool exhausted'))

      await expect(
        service.dispatchRun({
          type: 'district_issue_pulse',
          organizationSlug: 'org-1',
          clerkUserId: 'user_test_dispatch',
          params: {
            state: 'CA',
            city: 'San Francisco',
            l2DistrictType: 'city',
            l2DistrictName: 'San Francisco',
          },
        }),
      ).rejects.toThrow(BadGatewayException)

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          updateError: expect.any(Error),
          runId: expect.any(String),
        }),
        expect.stringContaining('stuck QUEUED'),
      )
    })

    it('does not send to SQS when the DB create fails', async () => {
      mockModel.create.mockRejectedValue(new Error('db down'))

      await expect(
        service.dispatchRun({
          type: 'district_issue_pulse',
          organizationSlug: 'org-1',
          clerkUserId: 'user_test_dispatch',
          params: {
            state: 'CA',
            city: 'San Francisco',
            l2DistrictType: 'city',
            l2DistrictName: 'San Francisco',
          },
        }),
      ).rejects.toThrow('db down')

      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0)
    })

    it('creates the run as QUEUED and forwards priority in the SQS body', async () => {
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' })

      const result = await service.dispatchRun({
        type: 'district_issue_pulse',
        organizationSlug: 'org-1',
        clerkUserId: 'user_test_dispatch',
        params: {
          state: 'CA',
          city: 'San Francisco',
          l2DistrictType: 'city',
          l2DistrictName: 'San Francisco',
        },
        priority: 'HIGH',
      })

      expect(result?.status).toBe(ExperimentRunStatus.QUEUED)
      expect(result?.priority).toBe('HIGH')
      expect(mockModel.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ priority: 'HIGH' }),
      })

      const call = requireFirst(sqsMock.commandCalls(SendMessageCommand))
      const body = JSON.parse(call.args[0].input.MessageBody as string) as {
        priority: string
        run_id: string
      }
      expect(body.priority).toBe('HIGH')
      expect(body.run_id).toBe(result?.runId)
    })

    it('defaults priority to DEFAULT when not given', async () => {
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' })

      const result = await service.dispatchRun({
        type: 'district_issue_pulse',
        organizationSlug: 'org-1',
        clerkUserId: 'user_test_dispatch',
        params: {
          state: 'CA',
          city: 'San Francisco',
          l2DistrictType: 'city',
          l2DistrictName: 'San Francisco',
        },
      })

      expect(result?.priority).toBe('DEFAULT')
      expect(mockModel.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ priority: 'DEFAULT' }),
      })

      const call = requireFirst(sqsMock.commandCalls(SendMessageCommand))
      const body = JSON.parse(call.args[0].input.MessageBody as string) as {
        priority: string
      }
      expect(body.priority).toBe('DEFAULT')
    })

    it('generates a unique run_id per dispatch', async () => {
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' })

      await service.dispatchRun({
        type: 'district_issue_pulse',
        organizationSlug: 'org-1',
        clerkUserId: 'user_test_dispatch',
        params: {
          state: 'CA',
          city: 'San Francisco',
          l2DistrictType: 'city',
          l2DistrictName: 'San Francisco',
        },
      })
      await service.dispatchRun({
        type: 'district_issue_pulse',
        organizationSlug: 'org-1',
        clerkUserId: 'user_test_dispatch',
        params: {
          state: 'CA',
          city: 'San Francisco',
          l2DistrictType: 'city',
          l2DistrictName: 'San Francisco',
        },
      })

      const id1 = mockModel.create.mock.calls[0]?.[0].data.runId as string
      const id2 = mockModel.create.mock.calls[1]?.[0].data.runId as string
      expect(id1).not.toBe(id2)
    })
  })

  describe('resumeRun', () => {
    const awaitingRun = {
      runId: 'run-abc-123',
      organizationSlug: 'org-1',
      experimentType: 'compliance_setup',
      status: ExperimentRunStatus.AWAITING_RESUME,
      params: { trigger: 'initial', clerk_user_id: 'user_clerk_123' },
      stage: 'domain_registration',
      resumeAttempts: 2,
      priority: 'DEFAULT',
    }

    it('re-dispatches a HIGH-priority run carrying its original priority', async () => {
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-resume-high' })
      mockModel.updateMany.mockResolvedValue({ count: 1 })

      await service.resumeRun({ ...awaitingRun, priority: 'HIGH' })

      const call = requireFirst(sqsMock.commandCalls(SendMessageCommand))
      const body = JSON.parse(call.args[0].input.MessageBody as string) as {
        priority: string
      }
      expect(body.priority).toBe('HIGH')
      expect(mockModel.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ priority: 'HIGH' }),
      })
    })

    it('re-dispatches a DEFAULT-priority run at DEFAULT', async () => {
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-resume-def' })
      mockModel.updateMany.mockResolvedValue({ count: 1 })

      await service.resumeRun(awaitingRun)

      const call = requireFirst(sqsMock.commandCalls(SendMessageCommand))
      const body = JSON.parse(call.args[0].input.MessageBody as string) as {
        priority: string
      }
      expect(body.priority).toBe('DEFAULT')
    })

    it(
      'mints a NEW run_id, creates a QUEUED row with incremented ' +
        'resumeAttempts, and sends SQS with the new run_id and ' +
        'trigger=recovery_resume',
      async () => {
        sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-resume-1' })
        mockModel.updateMany.mockResolvedValue({ count: 1 })

        await service.resumeRun(awaitingRun)

        expect(mockModel.create).toHaveBeenCalledOnce()
        const createCall = mockModel.create.mock.calls[0]?.[0] as {
          data: Record<string, unknown>
        }
        expect(createCall.data.runId).toBeDefined()
        expect(createCall.data.runId).not.toBe(awaitingRun.runId)
        expect(createCall.data.status).toBe(ExperimentRunStatus.QUEUED)
        expect(createCall.data.experimentType).toBe(awaitingRun.experimentType)
        expect(createCall.data.resumeAttempts).toBe(
          awaitingRun.resumeAttempts + 1,
        )
        expect(createCall.data.stage).toBe(awaitingRun.stage)

        const call = requireFirst(sqsMock.commandCalls(SendMessageCommand))
        expect(call).toBeDefined()
        const body = JSON.parse(
          call.args[0].input.MessageBody as string,
        ) as Record<string, unknown>
        expect(body.run_id).toBe(createCall.data.runId)
        expect(body.run_id).not.toBe(awaitingRun.runId)
        expect((body.params as Record<string, unknown>).trigger).toBe(
          'recovery_resume',
        )
        expect((body.params as Record<string, unknown>).clerk_user_id).toBe(
          'user_clerk_123',
        )
        expect(body.clerk_user_id).toBe('user_clerk_123')
      },
    )

    it(
      'terminalizes the old row as SUPERSEDED after a ' +
        'successful resume dispatch',
      async () => {
        sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-resume-1' })
        mockModel.updateMany.mockResolvedValue({ count: 1 })

        await service.resumeRun(awaitingRun)

        expect(mockModel.updateMany).toHaveBeenCalledWith({
          where: {
            runId: awaitingRun.runId,
            status: ExperimentRunStatus.AWAITING_RESUME,
          },
          data: {
            status: ExperimentRunStatus.SUPERSEDED,
            error: 'Superseded by resumed run',
          },
        })
      },
    )

    it(
      'claims the old row by nulling resumeScheduledFor (guarded on ' +
        'AWAITING_RESUME and resumeScheduledFor not null)',
      async () => {
        sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-resume-1' })
        mockModel.updateMany.mockResolvedValue({ count: 1 })

        await service.resumeRun(awaitingRun)

        expect(mockModel.updateMany).toHaveBeenCalledWith({
          where: {
            runId: awaitingRun.runId,
            status: ExperimentRunStatus.AWAITING_RESUME,
            resumeScheduledFor: { not: null },
          },
          data: { resumeScheduledFor: null },
        })
      },
    )

    it(
      'sends the clerk_user_id from params in the new run SQS body, ' +
        'not an empty string',
      async () => {
        sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-resume-2' })
        mockModel.updateMany.mockResolvedValue({ count: 1 })

        await service.resumeRun({
          runId: 'run-user-id-test',
          organizationSlug: 'org-1',
          experimentType: 'compliance_setup',
          params: { clerk_user_id: 'user_from_params' },
          stage: null,
          resumeAttempts: 0,
          priority: 'DEFAULT',
        })

        const call = requireFirst(sqsMock.commandCalls(SendMessageCommand))
        expect(call).toBeDefined()
        const body = JSON.parse(
          call.args[0].input.MessageBody as string,
        ) as Record<string, unknown>
        expect(body.clerk_user_id).toBe('user_from_params')
        expect(body.clerk_user_id).not.toBe('')
      },
    )

    it(
      'fails the run (guarded on AWAITING_RESUME) and sends no SQS ' +
        'message when params has no clerk_user_id',
      async () => {
        sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-resume-3' })

        await service.resumeRun({
          runId: 'run-missing-user',
          organizationSlug: 'org-1',
          experimentType: 'compliance_setup',
          params: { trigger: 'initial' },
          stage: null,
          resumeAttempts: 0,
          priority: 'DEFAULT',
        })

        expect(mockModel.updateMany).toHaveBeenCalledWith({
          where: {
            runId: 'run-missing-user',
            status: ExperimentRunStatus.AWAITING_RESUME,
          },
          data: {
            status: ExperimentRunStatus.FAILED,
            error: expect.stringContaining('clerk_user_id'),
          },
        })
        expect(mockModel.create).not.toHaveBeenCalled()
        expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0)
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ runId: 'run-missing-user' }),
          expect.any(String),
        )
      },
    )

    it(
      'does not create a new run or send SQS when the claim is lost ' +
        '(updateMany returns count 0)',
      async () => {
        sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-resume-1' })
        mockModel.updateMany.mockResolvedValue({ count: 0 })

        await service.resumeRun(awaitingRun)

        expect(mockModel.create).not.toHaveBeenCalled()
        expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0)
      },
    )

    it(
      'releases the claim (restores resumeScheduledFor on old row) ' +
        'when SQS send throws, and does not rethrow',
      async () => {
        sqsMock.on(SendMessageCommand).rejects(new Error('SQS down'))
        mockModel.updateMany.mockResolvedValue({ count: 1 })

        await expect(service.resumeRun(awaitingRun)).resolves.toBeUndefined()

        // The successor row was created then flipped to FAILED inside
        // createAndEnqueueRun's catch before the throw bubbled up.
        expect(mockModel.create).toHaveBeenCalledOnce()
        expect(mockModel.update).toHaveBeenCalledWith({
          where: { runId: expect.any(String) },
          data: {
            status: ExperimentRunStatus.FAILED,
            error: 'SQS dispatch failed',
          },
        })
        // The original row is released AND its attempt counter advanced so
        // MAX_RESUME_ATTEMPTS can eventually terminate a persistent failure.
        expect(mockModel.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              runId: awaitingRun.runId,
              status: ExperimentRunStatus.AWAITING_RESUME,
            }),
            data: {
              resumeScheduledFor: expect.any(Date),
              resumeAttempts: { increment: 1 },
            },
          }),
        )
      },
    )

    it(
      'releases the claim (does not supersede) when ' +
        'AGENT_DISPATCH_QUEUE_NAME is unset',
      async () => {
        delete process.env.AGENT_DISPATCH_QUEUE_NAME
        sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' })
        mockModel.updateMany.mockResolvedValue({ count: 1 })

        await service.resumeRun(awaitingRun)

        expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0)
        expect(mockModel.create).not.toHaveBeenCalled()
        // claim succeeded but no successor was created → release, not supersede
        expect(mockModel.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              resumeScheduledFor: expect.any(Date),
            }),
          }),
        )
        expect(mockModel.updateMany).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              error: 'Superseded by resumed run',
            }),
          }),
        )
      },
    )

    it('resolves the queue url once and caches it across resumes', async () => {
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' })
      mockModel.updateMany.mockResolvedValue({ count: 1 })

      await service.resumeRun(awaitingRun)
      await service.resumeRun(awaitingRun)

      expect(sqsMock.commandCalls(GetQueueUrlCommand)).toHaveLength(1)
    })
  })

  describe('sweepResumableRuns', () => {
    const makeRun = (overrides: Record<string, unknown> = {}) => ({
      runId: 'run-sweep-1',
      organizationSlug: 'org-2',
      experimentType: 'compliance_setup',
      status: ExperimentRunStatus.AWAITING_RESUME,
      params: { trigger: 'initial', clerk_user_id: 'user_sweep' },
      stage: 'domain_registration',
      resumeAttempts: 0,
      resumeScheduledFor: new Date(Date.now() - 1000),
      priority: 'DEFAULT',
      ...overrides,
    })

    it('caps resume attempts at 5', () => {
      expect(MAX_RESUME_ATTEMPTS).toBe(5)
    })

    it('resumes a run one attempt below the cap', async () => {
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' })
      const run = makeRun({ resumeAttempts: MAX_RESUME_ATTEMPTS - 1 })
      mockModel.findMany.mockResolvedValue([run])
      mockModel.updateMany.mockResolvedValue({ count: 1 })

      await service.sweepResumableRuns()

      expect(mockModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: ExperimentRunStatus.AWAITING_RESUME,
            resumeScheduledFor: expect.objectContaining({
              lte: expect.any(Date),
            }),
          }),
          orderBy: { resumeScheduledFor: 'asc' },
          take: 100,
        }),
      )

      const sqsCalls = sqsMock.commandCalls(SendMessageCommand)
      expect(sqsCalls.length).toBeGreaterThan(0)
    })

    it('re-dispatches a swept HIGH-priority run at HIGH', async () => {
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-sweep-high' })
      const run = makeRun({
        runId: 'run-sweep-high',
        priority: 'HIGH',
        resumeAttempts: 1,
      })
      mockModel.findMany.mockResolvedValue([run])
      mockModel.updateMany.mockResolvedValue({ count: 1 })

      await service.sweepResumableRuns()

      const call = requireFirst(sqsMock.commandCalls(SendMessageCommand))
      expect(call).toBeDefined()
      const body = JSON.parse(call.args[0].input.MessageBody as string) as {
        priority: string
      }
      expect(body.priority).toBe('HIGH')
    })

    it('excludes non-resumable experiment types from the sweep query', async () => {
      mockModel.findMany.mockResolvedValue([])

      await service.sweepResumableRuns()

      const where = mockModel.findMany.mock.calls[0]?.[0].where as {
        experimentType: { notIn: string[] }
      }
      expect(where.experimentType.notIn).toEqual(
        expect.arrayContaining(['meeting_briefing', 'meeting_schedule']),
      )
    })

    it(
      'sends the clerk_user_id from params in the SQS body when ' +
        'sweeper drives a resume',
      async () => {
        sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-sweep-clerk' })
        const run = makeRun({
          runId: 'run-sweep-clerk',
          params: { clerk_user_id: 'user_x', trigger: 'initial' },
          resumeAttempts: 1,
        })
        mockModel.findMany.mockResolvedValue([run])
        mockModel.updateMany.mockResolvedValue({ count: 1 })

        await service.sweepResumableRuns()

        const call = requireFirst(sqsMock.commandCalls(SendMessageCommand))
        expect(call).toBeDefined()
        const body = JSON.parse(
          call.args[0].input.MessageBody as string,
        ) as Record<string, unknown>
        expect(body.clerk_user_id).toBe('user_x')
        expect(body.clerk_user_id).not.toBe('')
      },
    )

    it(
      'does not claim or send SQS when the sweeper finds a run whose ' +
        'params have no clerk_user_id',
      async () => {
        sqsMock
          .on(SendMessageCommand)
          .resolves({ MessageId: 'm-sweep-no-user' })
        const run = makeRun({
          runId: 'run-sweep-no-user',
          params: { trigger: 'initial' },
          resumeAttempts: 1,
        })
        mockModel.findMany.mockResolvedValue([run])

        await service.sweepResumableRuns()

        expect(mockModel.updateMany).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: ExperimentRunStatus.RUNNING,
            }),
          }),
        )
        expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0)
      },
    )

    it(
      'marks runs at/over the attempt cap as FAILED guarded on ' +
        'AWAITING_RESUME status',
      async () => {
        const capRun = makeRun({ resumeAttempts: MAX_RESUME_ATTEMPTS })
        mockModel.findMany.mockResolvedValue([capRun])
        mockModel.updateMany.mockResolvedValue({ count: 1 })

        await service.sweepResumableRuns()

        expect(mockModel.updateMany).toHaveBeenCalledWith({
          where: {
            runId: capRun.runId,
            status: ExperimentRunStatus.AWAITING_RESUME,
          },
          data: {
            status: ExperimentRunStatus.FAILED,
            error: expect.stringContaining(String(MAX_RESUME_ATTEMPTS)),
          },
        })
        expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0)
      },
    )

    it('alerts Slack when it terminalizes a run at the attempt cap', async () => {
      const capRun = makeRun({ resumeAttempts: MAX_RESUME_ATTEMPTS })
      mockModel.findMany.mockResolvedValue([capRun])
      mockModel.updateMany.mockResolvedValue({ count: 1 })

      await service.sweepResumableRuns()

      expect(mockSlack.errorMessage).toHaveBeenCalledTimes(1)
      const [{ message }, channel] = requireFirst(
        mockSlack.errorMessage.mock.calls,
      )
      expect(message).toContain(capRun.runId)
      expect(channel).toBe('bot-10dlc-compliance')
    })

    it('does not alert when another replica already terminalized the run (count 0)', async () => {
      const capRun = makeRun({ resumeAttempts: MAX_RESUME_ATTEMPTS })
      mockModel.findMany.mockResolvedValue([capRun])
      mockModel.updateMany.mockResolvedValue({ count: 0 })

      await service.sweepResumableRuns()

      expect(mockSlack.errorMessage).not.toHaveBeenCalled()
    })

    it('isolates a throwing resumeRun so the rest of the batch still runs', async () => {
      const run1 = makeRun({ runId: 'run-sweep-throw', resumeAttempts: 1 })
      const run2 = makeRun({ runId: 'run-sweep-ok', resumeAttempts: 1 })
      mockModel.findMany.mockResolvedValue([run1, run2])
      const resumeSpy = vi
        .spyOn(service, 'resumeRun')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined)

      await expect(service.sweepResumableRuns()).resolves.toBeUndefined()

      expect(resumeSpy).toHaveBeenCalledTimes(2)
    })
  })
})
