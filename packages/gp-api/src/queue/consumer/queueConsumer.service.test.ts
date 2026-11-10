import { OrdinanceQualityLoopService } from '@/ordinances/services/ordinanceQualityLoop.service'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PinoLogger } from 'nestjs-pino'
import { UsersService } from '@/users/services/users.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { Test, TestingModule } from '@nestjs/testing'
import type { Message } from '@aws-sdk/client-sqs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PollsService } from 'src/polls/services/polls.service'
import { QueueType } from '../queue.types'
import { EmailOutreachQueueService } from '@/emailOutreach/services/emailOutreachQueue.service'
import { P2pPhoneListUploadService } from '@/vendors/peerly/services/p2pPhoneListUpload.service'
import { JobsService } from '@/jobs/jobs.service'
import { PrismaService } from '@/prisma/prisma.service'
import { QueueConsumerService } from './queueConsumer.service'

describe('QueueConsumerService - legacy pg-boss forwarders', () => {
  let service: QueueConsumerService
  let jobs: {
    send: ReturnType<typeof vi.fn>
    sendMany: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    jobs = {
      send: vi.fn().mockResolvedValue('job-1'),
      sendMany: vi.fn().mockResolvedValue(['job-1']),
    }
    service = new QueueConsumerService(
      {} as never,
      {} as never,
      createMockLogger(),
      {} as never,
      jobs as never,
      {} as never,
    )
  })

  it('hands a domainEmailForwarding message to its job under the boot backfill key, and acks', async () => {
    const result = await service.processMessage({
      MessageId: 'msg-domain-forwarding',
      Body: JSON.stringify({
        type: QueueType.DOMAIN_EMAIL_FORWARDING,
        data: { domainId: 123 },
      }),
    })

    expect(result).toBe(true)
    expect(jobs.sendMany).toHaveBeenCalledExactlyOnceWith(
      'domainEmailForwarding',
      [{ data: { domainId: 123 }, key: '123' }],
    )
  })

  it('hands a campaignStoryCompleted message to its job in the campaign group, and acks', async () => {
    const result = await service.processMessage({
      MessageId: 'msg-story-completed',
      Body: JSON.stringify({
        type: QueueType.CAMPAIGN_STORY_COMPLETED,
        data: { campaignId: 42 },
      }),
    })

    expect(result).toBe(true)
    expect(jobs.send).toHaveBeenCalledExactlyOnceWith(
      'campaignStoryCompleted',
      { campaignId: 42 },
      { group: '42' },
    )
  })

  it('throws a malformed campaignStoryCompleted payload toward the DLQ', async () => {
    await expect(
      service.processMessage({
        MessageId: 'msg-story-completed-bad',
        Body: JSON.stringify({
          type: QueueType.CAMPAIGN_STORY_COMPLETED,
          data: { campaignId: 'nope' },
        }),
      }),
    ).rejects.toThrow()
    expect(jobs.send).not.toHaveBeenCalled()
  })
})

describe('QueueConsumerService - message type routing', () => {
  let service: QueueConsumerService
  let module: TestingModule
  let mockCampaignsService: {
    model: { findUniqueOrThrow: ReturnType<typeof vi.fn> }
  }
  let mockSlackService: { message: ReturnType<typeof vi.fn> }
  let logger: ReturnType<typeof createMockLogger>
  let mockJobs: {
    send: ReturnType<typeof vi.fn>
    sendMany: ReturnType<typeof vi.fn>
    sendScheduleRun: ReturnType<typeof vi.fn>
  }
  let mockPrisma: {
    peerlyPhoneList: { findUnique: ReturnType<typeof vi.fn> }
  }
  let mockP2pPhoneListUpload: { enqueueBuild: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    mockJobs = {
      send: vi.fn().mockResolvedValue('job-1'),
      sendMany: vi.fn().mockResolvedValue(['job-1']),
      sendScheduleRun: vi.fn().mockResolvedValue(undefined),
    }
    mockCampaignsService = { model: { findUniqueOrThrow: vi.fn() } }
    mockSlackService = { message: vi.fn() }
    logger = createMockLogger()
    mockPrisma = { peerlyPhoneList: { findUnique: vi.fn() } }
    mockP2pPhoneListUpload = {
      enqueueBuild: vi.fn().mockResolvedValue(undefined),
    }

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        QueueConsumerService,
        { provide: CampaignsService, useValue: mockCampaignsService },
        { provide: ContactsService, useValue: {} },
        { provide: ElectedOfficeService, useValue: {} },
        { provide: PollsService, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: SlackService, useValue: mockSlackService },
        { provide: UsersService, useValue: {} },
        {
          provide: OrdinanceQualityLoopService,
          useValue: { enqueueStep: vi.fn() },
        },
        {
          provide: P2pPhoneListUploadService,
          useValue: mockP2pPhoneListUpload,
        },
        { provide: PinoLogger, useValue: logger },
        { provide: EmailOutreachQueueService, useValue: {} },
        { provide: JobsService, useValue: mockJobs },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()
    module = mod
    service = module.get(QueueConsumerService)
  })

  it.each([
    { type: QueueType.POLL_CREATION, job: 'pollCreation' },
    { type: QueueType.POLL_EXPANSION, job: 'pollExpansion' },
  ])(
    'hands a queued $type message to the $job job in its poll group, keyed by the message, and acks',
    async ({ type, job }) => {
      const pollId = '019a2f3c-0000-7000-8000-0000000000a1'
      const result = await service.processMessage({
        MessageId: `msg-${type}`,
        Body: JSON.stringify({ type, data: { pollId } }),
      })

      expect(result).toBe(true)
      expect(mockJobs.sendMany).toHaveBeenCalledExactlyOnceWith(job, [
        { data: { pollId }, key: `msg-${type}`, group: `polls-${pollId}` },
      ])
      expect(mockJobs.send).not.toHaveBeenCalled()
    },
  )

  it('hands a queued ocrAttachment message to the job queue, and acks', async () => {
    const attachmentId = 'cmaa0000000000000000ocr01'
    const result = await service.processMessage({
      MessageId: 'msg-ocr-attachment',
      Body: JSON.stringify({
        type: QueueType.OCR_ATTACHMENT,
        data: { attachmentId },
      }),
    })

    expect(result).toBe(true)
    expect(mockJobs.send).toHaveBeenCalledExactlyOnceWith(
      'ocrAttachment',
      { attachmentId },
      { group: attachmentId },
    )
  })

  it('hands a queued extractChatAttachment message to the job queue, and acks', async () => {
    const attachmentId = '019a2f3c-0000-7000-8000-0000000000c1'
    const result = await service.processMessage({
      MessageId: 'msg-extract-chat-attachment',
      Body: JSON.stringify({
        type: QueueType.EXTRACT_CHAT_ATTACHMENT,
        data: { attachmentId },
      }),
    })

    expect(result).toBe(true)
    expect(mockJobs.send).toHaveBeenCalledExactlyOnceWith(
      'extractChatAttachment',
      { attachmentId },
      { group: attachmentId },
    )
  })

  it('forwards campaignPlanComplete to its job, keyed by the message and grouped by campaign', async () => {
    const data = {
      campaignId: 123,
      status: 'completed',
      s3Key: 'results/123/test.json',
      taskCount: 10,
    }

    const result = await service.processMessage({
      MessageId: 'msg-plan-complete',
      Body: JSON.stringify({ type: QueueType.CAMPAIGN_PLAN_COMPLETE, data }),
    })

    expect(result).toBe(true)
    expect(mockJobs.sendMany).toHaveBeenCalledExactlyOnceWith(
      'campaignPlanComplete',
      [{ data, key: 'msg-plan-complete', group: '123' }],
    )
  })

  it('acks and drops a malformed campaignPlanComplete without queueing a job', async () => {
    const result = await service.processMessage({
      MessageId: 'msg-plan-bad',
      Body: JSON.stringify({
        type: QueueType.CAMPAIGN_PLAN_COMPLETE,
        data: { campaignId: 123, status: 'completed' },
      }),
    })

    expect(result).toBe(true)
    expect(mockJobs.sendMany).not.toHaveBeenCalled()
  })

  it('forwards pollAnalysisComplete to its job, grouped by poll', async () => {
    const data = {
      pollId: 'poll-1',
      totalResponses: 0,
      responsesLocation: 'polls/poll-1/all_cluster_analysis.json',
      issues: [],
    }

    const result = await service.processMessage({
      MessageId: 'msg-poll-analysis',
      Body: JSON.stringify({ type: QueueType.POLL_ANALYSIS_COMPLETE, data }),
    })

    expect(result).toBe(true)
    expect(mockJobs.sendMany).toHaveBeenCalledExactlyOnceWith(
      'pollAnalysisComplete',
      [{ data, key: 'msg-poll-analysis', group: 'poll-1' }],
    )
  })

  it('throws a malformed pollAnalysisComplete toward the DLQ', async () => {
    await expect(
      service.processMessage({
        MessageId: 'msg-poll-analysis-bad',
        Body: JSON.stringify({
          type: QueueType.POLL_ANALYSIS_COMPLETE,
          data: { pollId: 'poll-1' },
        }),
      }),
    ).rejects.toThrow()
    expect(mockJobs.sendMany).not.toHaveBeenCalled()
  })

  it('forwards agentExperimentResult to its job, grouped by run', async () => {
    const data = { runId: 'run-1', status: 'started' }

    const result = await service.processMessage({
      MessageId: 'msg-agent-result',
      Body: JSON.stringify({ type: QueueType.AGENT_EXPERIMENT_RESULT, data }),
    })

    expect(result).toBe(true)
    expect(mockJobs.sendMany).toHaveBeenCalledExactlyOnceWith(
      'agentExperimentResult',
      [{ data, key: 'msg-agent-result', group: 'run-1' }],
    )
  })

  it.each([
    ['an unknown status', { runId: 'run-1', status: 'weird' }],
    ['no runId', { status: 'success' }],
  ])(
    'throws an agentExperimentResult with %s toward the DLQ',
    async (_case, data) => {
      await expect(
        service.processMessage({
          MessageId: 'msg-agent-result-bad',
          Body: JSON.stringify({
            type: QueueType.AGENT_EXPERIMENT_RESULT,
            data,
          }),
        }),
      ).rejects.toThrow()
      expect(mockJobs.sendMany).not.toHaveBeenCalled()
    },
  )

  it('lets a failed send propagate so the message redelivers', async () => {
    mockJobs.sendMany.mockRejectedValue(new Error('db down'))

    await expect(
      service.processMessage({
        MessageId: 'msg-agent-result-db-down',
        Body: JSON.stringify({
          type: QueueType.AGENT_EXPERIMENT_RESULT,
          data: { runId: 'run-1', status: 'started' },
        }),
      }),
    ).rejects.toThrow('db down')
  })

  // outreachTextSend and p2pPhoneListBuild run on pg-boss; these cases only
  // hand a message the previous release left in SQS to the job.
  const outreachTextSendMessage = (data: unknown): Message => ({
    MessageId: 'msg-outreach-text-send',
    Body: JSON.stringify({ type: QueueType.OUTREACH_TEXT_SEND, data }),
  })

  it('hands an outreachTextSend message to the job under its producers key, agent hand-off included', async () => {
    const agentHandoff = {
      mode: 'shadow',
      sendAt: '2026-10-10T18:00:00.000Z',
      timeZone: 'US/Pacific',
    }

    const result = await service.processMessage(
      outreachTextSendMessage({ outreachId: 7, sendSeq: 2, agentHandoff }),
    )

    expect(result).toBe(true)
    expect(mockJobs.sendMany).toHaveBeenCalledExactlyOnceWith(
      'outreachTextSend',
      [
        {
          data: { outreachId: 7, sendSeq: 2, agentHandoff },
          key: '7:2',
          group: '7',
        },
      ],
    )
  })

  it('defaults a forwarded outreachTextSend to the first send', async () => {
    await service.processMessage(outreachTextSendMessage({ outreachId: 9 }))

    expect(mockJobs.sendMany).toHaveBeenCalledExactlyOnceWith(
      'outreachTextSend',
      [{ data: { outreachId: 9, sendSeq: 1 }, key: '9:1', group: '9' }],
    )
  })

  // A payload the schema cannot read is our own producer's bug on a paid
  // send. It throws so it ages to the DLQ instead of being ack-dropped.
  it('refuses to acknowledge a malformed outreachTextSend payload', async () => {
    await expect(
      service.processMessage(outreachTextSendMessage({ sendSeq: 1 })),
    ).rejects.toThrow()
    expect(mockJobs.sendMany).not.toHaveBeenCalled()
  })

  it('lets a failed hand-off throw so the message redelivers', async () => {
    mockJobs.sendMany.mockRejectedValue(new Error('database down'))

    await expect(
      service.processMessage(outreachTextSendMessage({ outreachId: 9 })),
    ).rejects.toThrow('database down')
  })

  const buildId = '019a2f3c-0000-7000-8000-000000000003'
  const phoneListBuildMessage = (): Message => ({
    MessageId: 'msg-p2p-phone-list-build',
    Body: JSON.stringify({
      type: QueueType.P2P_PHONE_LIST_BUILD,
      data: { buildId },
    }),
  })

  it('hands a p2pPhoneListBuild message to the job under the attempt it was sent for', async () => {
    mockPrisma.peerlyPhoneList.findUnique.mockResolvedValue({
      buildAttempts: 1,
    })

    const result = await service.processMessage(phoneListBuildMessage())

    expect(result).toBe(true)
    expect(mockPrisma.peerlyPhoneList.findUnique).toHaveBeenCalledWith({
      where: { id: buildId },
      select: { buildAttempts: true },
    })
    expect(mockP2pPhoneListUpload.enqueueBuild).toHaveBeenCalledExactlyOnceWith(
      buildId,
      1,
    )
  })

  it('acks a p2pPhoneListBuild message for a deleted build without a job', async () => {
    mockPrisma.peerlyPhoneList.findUnique.mockResolvedValue(null)

    expect(await service.processMessage(phoneListBuildMessage())).toBe(true)
    expect(mockP2pPhoneListUpload.enqueueBuild).not.toHaveBeenCalled()
  })

  it('acknowledges unknown message types via default branch', async () => {
    const message: Message = {
      MessageId: 'msg-unknown',
      Body: JSON.stringify({
        type: 'someUnknownFutureType',
        data: {},
      }),
    }

    const result = await service.processMessage(message)

    expect(result).toBe(true)
  })

  it('hands an ordinanceQualityLoop message to the loop as a job step', async () => {
    const loop = module.get(OrdinanceQualityLoopService)
    const enqueueSpy = vi
      .spyOn(loop, 'enqueueStep')
      .mockResolvedValue(undefined)
    const data = {
      ordinanceId: 'ord-1',
      loopRunId: 'run-1',
      iteration: 0,
      phase: 'qc',
      expectedInputHash: 'hash-1',
      attempt: 1,
    }

    const result = await service.processMessage({
      MessageId: 'msg-quality-loop',
      Body: JSON.stringify({
        type: QueueType.ORDINANCE_QUALITY_LOOP,
        data,
      }),
    })

    expect(result).toBe(true)
    expect(enqueueSpy).toHaveBeenCalledWith(data)
  })

  it('hands a tcrComplianceStatusCheck message to its job by record id, and acks', async () => {
    const result = await service.processMessage({
      MessageId: 'msg-tcr-check',
      Body: JSON.stringify({
        type: QueueType.TCR_COMPLIANCE_STATUS_CHECK,
        data: {
          tcrCompliance: {
            id: 'ckpqr7s3z00010o9k1234abcd',
            peerlyIdentityId: 'peerly-999',
          },
        },
      }),
    })

    expect(result).toBe(true)
    expect(mockJobs.send).toHaveBeenCalledExactlyOnceWith(
      'tcrComplianceStatusCheck',
      { tcrComplianceId: 'ckpqr7s3z00010o9k1234abcd' },
    )
  })

  it('hands an agenticComplianceKickoff message to its job in the campaign group, and acks', async () => {
    const validTcrCuid = 'ckpqr7s3z00010o9k1234abcd'
    const result = await service.processMessage({
      MessageId: 'msg-kickoff-ok',
      Body: JSON.stringify({
        type: QueueType.AGENTIC_COMPLIANCE_KICKOFF,
        data: {
          campaignId: 42,
          tcrComplianceId: validTcrCuid,
          clerkUserId: 'user_clerk_xyz',
        },
      }),
    })

    expect(result).toBe(true)
    expect(mockJobs.send).toHaveBeenCalledExactlyOnceWith(
      'agenticComplianceKickoff',
      {
        campaignId: 42,
        tcrComplianceId: validTcrCuid,
        clerkUserId: 'user_clerk_xyz',
      },
      { group: '42' },
    )
  })

  it.each([
    [
      QueueType.NIGHTLY_10DLC_REPORT,
      { reportDate: '2026-07-10' },
      'nightly10DlcReport',
    ],
    [
      QueueType.PEERLY_VENDOR_ESCALATION,
      { escalationDate: '2026-07-10' },
      'peerlyVendorEscalation',
    ],
    [QueueType.CV_STATUS_POLL, { scanKey: '2026-08-17-08' }, 'cvStatusScan'],
    [
      QueueType.CV_STATUS_POLL,
      { scanKey: '2026-09-28-13-39', fresh: true },
      'cvStatusFreshScan',
    ],
  ])(
    'hands a %s message to one run of its schedule, and acks',
    async (type, data, schedule) => {
      const result = await service.processMessage({
        MessageId: `msg-${type}`,
        Body: JSON.stringify({ type, data }),
      })

      expect(result).toBe(true)
      expect(mockJobs.sendScheduleRun).toHaveBeenCalledExactlyOnceWith(schedule)
    },
  )
})

describe('QueueConsumerService - ORDINANCE_QUALITY_LOOP', () => {
  const buildService = (enqueueStep: ReturnType<typeof vi.fn>) =>
    new QueueConsumerService(
      { enqueueStep } as never,
      {} as never,
      createMockLogger(),
      {} as never,
      {} as never,
      {} as never,
    )

  const loopMessage = (data: unknown): Message => ({
    MessageId: 'msg-loop-1',
    Body: JSON.stringify({ type: QueueType.ORDINANCE_QUALITY_LOOP, data }),
  })

  it('hands a valid quality loop step to the job queue', async () => {
    const enqueueStep = vi.fn().mockResolvedValue(undefined)
    const service = buildService(enqueueStep)
    const payload = {
      ordinanceId: 'o1',
      loopRunId: 'run-1',
      iteration: 1,
      phase: 'qc',
      expectedInputHash: 'hash-1',
      attempt: 1,
    }

    const result = await service.processMessage(loopMessage(payload))

    expect(result).toBe(true)
    expect(enqueueStep).toHaveBeenCalledWith(payload)
  })

  it('acks and drops a malformed quality loop message instead of requeueing', async () => {
    const enqueueStep = vi.fn()
    const service = buildService(enqueueStep)

    // A malformed message can never become valid; requeueing it would block
    // the ordinance's FIFO group with redeliveries until the DLQ limit.
    const result = await service.processMessage(
      loopMessage({ ordinanceId: 'o1' }),
    )

    expect(result).toBe(true)
    expect(enqueueStep).not.toHaveBeenCalled()
  })
})

describe('QueueConsumerService - FEEDBACK_SYNTHESIS_COMPLETE', () => {
  const buildService = (sendMany: ReturnType<typeof vi.fn>) =>
    new QueueConsumerService(
      {} as never,
      {} as never,
      createMockLogger(),
      {} as never,
      { sendMany } as never,
      {} as never,
    )

  const synthesisMessage = (data: object): Message => ({
    MessageId: 'msg-synthesis-1',
    Body: JSON.stringify({ type: QueueType.FEEDBACK_SYNTHESIS_COMPLETE, data }),
  })

  it('forwards a valid event to its job, grouped by run', async () => {
    const sendMany = vi.fn().mockResolvedValue(['job-1'])
    const service = buildService(sendMany)
    const data = {
      sourceType: 'constituent_feedback',
      sourceId: 'run-1',
      totalResponses: 2,
      responsesLocation: 'output/feedback/run-1.json',
      issues: [
        {
          rank: 1,
          theme: 'Street flooding',
          summary: 's',
          analysis: 'a',
          responseCount: 2,
          quotes: [{ quote: 'q', respondent_id: 'feedback-1' }],
        },
      ],
    }

    const result = await service.processMessage(synthesisMessage(data))

    expect(result).toBe(true)
    expect(sendMany).toHaveBeenCalledExactlyOnceWith(
      'feedbackSynthesisComplete',
      [{ data, key: 'msg-synthesis-1', group: 'run-1' }],
    )
  })

  it('acks and drops a malformed event instead of requeueing', async () => {
    const sendMany = vi.fn()
    const service = buildService(sendMany)

    const result = await service.processMessage(
      synthesisMessage({ sourceId: 'run-1' }),
    )

    expect(result).toBe(true)
    expect(sendMany).not.toHaveBeenCalled()
  })
})
