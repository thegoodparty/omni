import { OrdinanceQualityLoopService } from '@/ordinances/services/ordinanceQualityLoop.service'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { Nightly10DlcReportService } from '@/campaigns/tcrCompliance/services/nightly10DlcReport.service'
import { CvStatusPollService } from '@/campaigns/tcrCompliance/services/cvStatusPoll.service'
import { CampaignTcrComplianceService } from '@/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PinoLogger } from 'nestjs-pino'
import { UsersService } from '@/users/services/users.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { Test, TestingModule } from '@nestjs/testing'
import type { Message } from '@aws-sdk/client-sqs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { PollsService } from 'src/polls/services/polls.service'
import { QueueType } from '../queue.types'
import { OutreachService } from '@/outreach/services/outreach.service'
import { OutreachServePollExpansionService } from '@/outreach/services/outreachServePollExpansion.service'
import { OutreachTextDeliveryService } from '@/outreach/services/outreachTextDelivery.service'
import { OutreachTextSendFundingService } from '@/outreach/services/outreachTextSendFunding.service'
import { EmailOutreachQueueService } from '@/emailOutreach/services/emailOutreachQueue.service'
import { P2pPhoneListUploadService } from '@/vendors/peerly/services/p2pPhoneListUpload.service'
import { JobsService } from '@/jobs/jobs.service'
import { QueueConsumerService } from './queueConsumer.service'

describe('QueueConsumerService - legacy pg-boss forwarders', () => {
  let service: QueueConsumerService
  let jobs: { send: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    jobs = { send: vi.fn().mockResolvedValue('job-1') }
    service = new QueueConsumerService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createMockLogger(),
      {} as never,
      {} as never,
      jobs as never,
    )
  })

  it('hands a domainEmailForwarding message to its job, and acks', async () => {
    const result = await service.processMessage({
      MessageId: 'msg-domain-forwarding',
      Body: JSON.stringify({
        type: QueueType.DOMAIN_EMAIL_FORWARDING,
        data: { domainId: 123 },
      }),
    })

    expect(result).toBe(true)
    expect(jobs.send).toHaveBeenCalledExactlyOnceWith('domainEmailForwarding', {
      domainId: 123,
    })
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

describe('QueueConsumerService - triggerPollExecution', () => {
  let service: QueueConsumerService
  let pollsService: {
    findUnique: ReturnType<typeof vi.fn>
    client: {
      pollIndividualMessage: {
        findMany: ReturnType<typeof vi.fn>
        createMany: ReturnType<typeof vi.fn>
      }
    }
  }
  let electedOfficeService: {
    findUnique: ReturnType<typeof vi.fn>
    client: {
      electedOffice: { findUnique: ReturnType<typeof vi.fn> }
    }
  }
  let contactsService: { sampleContacts: ReturnType<typeof vi.fn> }
  let s3Service: {
    getFile: ReturnType<typeof vi.fn>
    buildKey: ReturnType<typeof vi.fn>
    uploadFile: ReturnType<typeof vi.fn>
  }
  let usersService: { findUnique: ReturnType<typeof vi.fn> }

  const pollId = 'poll-456'
  const electedOfficeId = 'office-1'
  const officeUserId = 1

  const makePoll = (overrides: Record<string, unknown> = {}) => ({
    id: pollId,
    electedOfficeId,
    isCompleted: false,
    scheduledDate: new Date('2020-01-01'),
    estimatedCompletionDate: new Date('2020-01-04'),
    targetAudienceSize: 500,
    messageContent: 'What issues matter to you?',
    imageUrl: null,
    ...overrides,
  })

  beforeEach(() => {
    vi.stubEnv('TEVYN_POLL_CSVS_BUCKET', 'test-csv-bucket')

    pollsService = {
      findUnique: vi.fn().mockResolvedValue(makePoll()),
      client: {
        pollIndividualMessage: {
          findMany: vi.fn().mockResolvedValue([]),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      },
    }
    electedOfficeService = {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: electedOfficeId, userId: officeUserId }),
      client: {
        electedOffice: {
          findUnique: vi.fn().mockResolvedValue({
            id: electedOfficeId,
            userId: officeUserId,
            organizationSlug: 'eo-office-1',
            organization: {
              slug: 'eo-office-1',
              positionId: 'position-uuid',
              customPositionName: null,
              overrideDistrictId: 'district-uuid',
            },
          }),
        },
      },
    }
    contactsService = {
      sampleContacts: vi.fn().mockResolvedValue([
        {
          id: 'person-1',
          firstName: 'Alice',
          lastName: 'Smith',
          cellPhone: '+15551111111',
        },
        {
          id: 'person-2',
          firstName: 'Bob',
          lastName: 'Jones',
          cellPhone: '+15552222222',
        },
      ]),
    }
    s3Service = {
      getFile: vi.fn().mockResolvedValue(null),
      buildKey: vi.fn().mockReturnValue('test-key.csv'),
      uploadFile: vi.fn().mockResolvedValue(undefined),
    }
    usersService = {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-1',
        firstName: 'Test',
        lastName: 'User',
        email: 'test@test.com',
        phone: null,
      }),
    }

    service = new QueueConsumerService(
      { client: {} } as never,
      {} as never,
      pollsService as never,
      electedOfficeService as never,
      contactsService as never,
      s3Service as never,
      usersService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createMockLogger(),
      {} as never,
      {} as never,
      {} as never,
    )
  })

  it('handlePollCreation creates ELECTED_OFFICIAL records with electedOfficeId', async () => {
    const message: Message = {
      MessageId: 'msg-creation',
      Body: JSON.stringify({
        type: QueueType.POLL_CREATION,
        data: { pollId },
      }),
    }

    await service.processMessage(message)

    expect(
      pollsService.client.pollIndividualMessage.createMany,
    ).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          pollId,
          electedOfficeId,
          personCellPhone: expect.stringMatching(/^\+1\d{10}$/),
        }),
      ]),
      skipDuplicates: true,
    })
    const { data } = firstOrThrow(
      pollsService.client.pollIndividualMessage.createMany.mock.calls,
    )[0]
    expect(data).toHaveLength(2)
  })

  it('handlePollExpansion only counts ELECTED_OFFICIAL records for alreadySent', async () => {
    const existingRecords = [
      { personId: 'person-existing-1' },
      { personId: 'person-existing-2' },
    ]
    pollsService.client.pollIndividualMessage.findMany.mockResolvedValue(
      existingRecords,
    )
    pollsService.findUnique.mockResolvedValue(
      makePoll({ targetAudienceSize: 1000 }),
    )

    const message: Message = {
      MessageId: 'msg-expansion',
      Body: JSON.stringify({
        type: QueueType.POLL_EXPANSION,
        data: { pollId },
      }),
    }

    await service.processMessage(message)

    // Verify the alreadySent query filters by ELECTED_OFFICIAL sender
    expect(
      pollsService.client.pollIndividualMessage.findMany,
    ).toHaveBeenCalledWith({
      where: {
        pollId,
        sender: 'ELECTED_OFFICIAL',
      },
      select: { personId: true },
    })

    // Verify sampleContacts receives correct size, excludeIds, and organization
    expect(contactsService.sampleContacts).toHaveBeenCalledWith(
      {
        size: 1000 - existingRecords.length,
        excludeIds: ['person-existing-1', 'person-existing-2'],
      },
      expect.objectContaining({ slug: 'eo-office-1' }),
    )
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
  let mockOutreachService: {
    model: { findUnique: ReturnType<typeof vi.fn> }
  }
  let mockOutreachTextDelivery: { requestSend: ReturnType<typeof vi.fn> }
  let mockPollExpansion: { resolveDelivery: ReturnType<typeof vi.fn> }
  let mockTextSendFunding: {
    check: ReturnType<typeof vi.fn>
    reportRefusal: ReturnType<typeof vi.fn>
  }
  let mockJobs: {
    send: ReturnType<typeof vi.fn>
    sendMany: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    mockJobs = {
      send: vi.fn().mockResolvedValue('job-1'),
      sendMany: vi.fn().mockResolvedValue(['job-1']),
    }
    mockCampaignsService = { model: { findUniqueOrThrow: vi.fn() } }
    mockSlackService = { message: vi.fn() }
    logger = createMockLogger()
    mockOutreachService = { model: { findUnique: vi.fn() } }
    mockOutreachTextDelivery = { requestSend: vi.fn() }
    mockPollExpansion = { resolveDelivery: vi.fn() }
    mockTextSendFunding = {
      check: vi.fn().mockResolvedValue({ funded: true, via: 'checkout' }),
      reportRefusal: vi.fn(),
    }

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        QueueConsumerService,
        { provide: CampaignsService, useValue: mockCampaignsService },
        {
          provide: CampaignTcrComplianceService,
          useValue: {
            handleAgenticKickoff: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: ContactsService, useValue: {} },
        { provide: ElectedOfficeService, useValue: {} },
        { provide: PollsService, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: SlackService, useValue: mockSlackService },
        { provide: UsersService, useValue: {} },
        {
          provide: Nightly10DlcReportService,
          useValue: { handleNightlyReport: vi.fn().mockResolvedValue(true) },
        },
        {
          provide: CvStatusPollService,
          useValue: { handleCvStatusPoll: vi.fn().mockReturnValue(true) },
        },
        {
          provide: OrdinanceQualityLoopService,
          useValue: { enqueueStep: vi.fn() },
        },
        { provide: OutreachService, useValue: mockOutreachService },
        {
          provide: OutreachTextDeliveryService,
          useValue: mockOutreachTextDelivery,
        },
        {
          provide: OutreachServePollExpansionService,
          useValue: mockPollExpansion,
        },
        { provide: P2pPhoneListUploadService, useValue: {} },
        { provide: PinoLogger, useValue: logger },
        {
          provide: OutreachTextSendFundingService,
          useValue: mockTextSendFunding,
        },
        { provide: EmailOutreachQueueService, useValue: {} },
        { provide: JobsService, useValue: mockJobs },
      ],
    }).compile()
    module = mod
    service = module.get(QueueConsumerService)
  })

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

  // These replace the placeholder test that pinned the deliberate throw. The
  // case is no longer allowed to behave like the default branch OR to throw:
  // it routes to the delivery layer, and the interesting part is which
  // outcomes ack and which redeliver.
  const outreachTextSendMessage = (
    data: unknown = { outreachId: 1, sendSeq: 1 },
  ): Message => ({
    MessageId: 'msg-outreach-text-send',
    Body: JSON.stringify({ type: QueueType.OUTREACH_TEXT_SEND, data }),
  })

  it('routes outreachTextSend to the delivery layer with the row audience', async () => {
    mockOutreachService.model.findUnique.mockResolvedValue({
      message: 'Trash pickup moves to Thursday.',
      imageUrl: 'https://example.com/flyer.png',
      scheduledLocalDate: '2026-10-08',
      voterFileFilterId: 77,
    })
    mockOutreachTextDelivery.requestSend.mockResolvedValue({
      audienceResolved: true,
      recipientCount: 412,
      excludedOptedOutCount: 3,
      excludedDuplicateCount: 1,
      sendKey: '1-1.csv',
    })

    const result = await service.processMessage(
      outreachTextSendMessage({ outreachId: 1, sendSeq: 1 }),
    )

    expect(result).toBe(true)
    expect(mockOutreachTextDelivery.requestSend).toHaveBeenCalledWith({
      outreachId: 1,
      sendSeq: 1,
      audience: { kind: 'savedFilter', voterFileFilterId: 77 },
      message: 'Trash pickup moves to Thursday.',
      imageUrl: 'https://example.com/flyer.png',
      scheduledLocalDate: '2026-10-08',
    })
  })

  it('passes an agent hand-off on the message to the delivery layer', async () => {
    mockOutreachService.model.findUnique.mockResolvedValue({
      message: 'Trash pickup moves to Thursday.',
      scheduledLocalDate: '2026-10-10',
      voterFileFilterId: 77,
    })
    mockOutreachTextDelivery.requestSend.mockResolvedValue({
      audienceResolved: true,
      recipientCount: 40,
      excludedOptedOutCount: 0,
      excludedDuplicateCount: 0,
      sendKey: '1-1.csv',
    })

    await service.processMessage(
      outreachTextSendMessage({
        outreachId: 1,
        sendSeq: 1,
        agentHandoff: {
          mode: 'shadow',
          sendAt: '2026-10-10T18:00:00.000Z',
          timeZone: 'US/Pacific',
        },
      }),
    )

    expect(mockOutreachTextDelivery.requestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        agentHandoff: {
          mode: 'shadow',
          sendAt: new Date('2026-10-10T18:00:00.000Z'),
          timeZone: 'US/Pacific',
        },
      }),
    )
  })

  it('acks an unfunded outreachTextSend without building an audience', async () => {
    mockOutreachService.model.findUnique.mockResolvedValue({
      message: 'Trash pickup moves to Thursday.',
      scheduledLocalDate: '2026-10-08',
      voterFileFilterId: 77,
    })
    mockTextSendFunding.check.mockResolvedValue({
      funded: false,
      reason: 'unpaid',
    })

    const result = await service.processMessage(
      outreachTextSendMessage({ outreachId: 1, sendSeq: 1 }),
    )

    expect(result).toBe(true)
    expect(mockTextSendFunding.reportRefusal).toHaveBeenCalledWith(
      1,
      1,
      'unpaid',
    )
    expect(mockOutreachTextDelivery.requestSend).not.toHaveBeenCalled()
  })

  it('leaves a send that is not pending to the delivery claim', async () => {
    mockOutreachService.model.findUnique.mockResolvedValue({
      message: 'Trash pickup moves to Thursday.',
      scheduledLocalDate: '2026-10-08',
      voterFileFilterId: 77,
    })
    mockTextSendFunding.check.mockResolvedValue({
      funded: false,
      reason: 'not_sendable',
    })
    mockOutreachTextDelivery.requestSend.mockResolvedValue({
      audienceResolved: false,
      recipientCount: 0,
      excludedOptedOutCount: 0,
      excludedDuplicateCount: 0,
      sendKey: '1-1.csv',
      terminalReason: 'not_sendable',
    })

    await service.processMessage(
      outreachTextSendMessage({ outreachId: 1, sendSeq: 1 }),
    )

    expect(mockTextSendFunding.reportRefusal).not.toHaveBeenCalled()
    expect(mockOutreachTextDelivery.requestSend).toHaveBeenCalled()
  })

  describe('outreachTextSend for a poll', () => {
    const pollRow = (overrides: Record<string, unknown> = {}) => ({
      outreachType: 'poll',
      approvedAt: new Date('2026-10-10T12:00:00Z'),
      message: 'Hi, do you support the park?',
      imageUrl: null,
      scheduledLocalDate: '2026-10-14',
      voterFileFilterId: null,
      textCount: 250,
      pollDetails: { audienceKind: 'sample' },
      ...overrides,
    })
    const delivered = {
      audienceResolved: true,
      recipientCount: 250,
      excludedOptedOutCount: 0,
      excludedDuplicateCount: 0,
      sendKey: '3-1.csv',
    }

    it('delivers a sample poll as a sample of textCount people', async () => {
      mockOutreachService.model.findUnique.mockResolvedValue(pollRow())
      mockOutreachTextDelivery.requestSend.mockResolvedValue(delivered)

      const result = await service.processMessage(
        outreachTextSendMessage({ outreachId: 3, sendSeq: 1 }),
      )

      expect(result).toBe(true)
      expect(mockOutreachTextDelivery.requestSend).toHaveBeenCalledWith(
        expect.objectContaining({
          audience: { kind: 'sample', size: 250 },
          paidRecipientCap: 250,
        }),
      )
    })

    it('delivers a list poll to its saved filter', async () => {
      mockOutreachService.model.findUnique.mockResolvedValue(
        pollRow({
          voterFileFilterId: 61,
          pollDetails: { audienceKind: 'list' },
        }),
      )
      mockOutreachTextDelivery.requestSend.mockResolvedValue(delivered)

      await service.processMessage(
        outreachTextSendMessage({ outreachId: 3, sendSeq: 1 }),
      )

      expect(mockOutreachTextDelivery.requestSend).toHaveBeenCalledWith(
        expect.objectContaining({
          audience: { kind: 'savedFilter', voterFileFilterId: 61 },
        }),
      )
    })

    it('sends nothing for a poll that was never approved', async () => {
      mockOutreachService.model.findUnique.mockResolvedValue(
        pollRow({ approvedAt: null }),
      )

      const result = await service.processMessage(
        outreachTextSendMessage({ outreachId: 3, sendSeq: 1 }),
      )

      expect(result).toBe(true)
      expect(mockOutreachTextDelivery.requestSend).not.toHaveBeenCalled()
    })

    it('delivers an expansion as a sample that excludes earlier recipients', async () => {
      mockOutreachService.model.findUnique.mockResolvedValue(pollRow())
      mockPollExpansion.resolveDelivery.mockResolvedValue({
        textCount: 80,
        excludePersonIds: ['person-1', 'person-2'],
      })
      mockOutreachTextDelivery.requestSend.mockResolvedValue({
        ...delivered,
        recipientCount: 80,
        sendKey: '3-2.csv',
      })

      const result = await service.processMessage(
        outreachTextSendMessage({ outreachId: 3, sendSeq: 2 }),
      )

      expect(result).toBe(true)
      expect(mockPollExpansion.resolveDelivery).toHaveBeenCalledWith(3, 2)
      expect(mockOutreachTextDelivery.requestSend).toHaveBeenCalledWith(
        expect.objectContaining({
          sendSeq: 2,
          audience: {
            kind: 'sample',
            size: 80,
            excludePersonIds: ['person-1', 'person-2'],
          },
          paidRecipientCap: 80,
        }),
      )
    })

    it('sends nothing for an expansion that was never approved', async () => {
      mockOutreachService.model.findUnique.mockResolvedValue(pollRow())
      mockPollExpansion.resolveDelivery.mockResolvedValue(null)

      const result = await service.processMessage(
        outreachTextSendMessage({ outreachId: 3, sendSeq: 2 }),
      )

      expect(result).toBe(true)
      expect(mockOutreachTextDelivery.requestSend).not.toHaveBeenCalled()
    })
  })

  it('defaults sendSeq to 1 and passes no imageUrl when the row has none', async () => {
    mockOutreachService.model.findUnique.mockResolvedValue({
      message: 'Budget hearing Tuesday.',
      imageUrl: null,
      scheduledLocalDate: '2026-10-08',
      voterFileFilterId: 5,
    })
    mockOutreachTextDelivery.requestSend.mockResolvedValue({
      audienceResolved: true,
      recipientCount: 30,
      excludedOptedOutCount: 0,
      excludedDuplicateCount: 0,
      sendKey: '9-1.csv',
    })

    await service.processMessage(outreachTextSendMessage({ outreachId: 9 }))

    expect(mockOutreachTextDelivery.requestSend).toHaveBeenCalledWith(
      expect.objectContaining({ sendSeq: 1, imageUrl: undefined }),
    )
  })

  // The refused-send path: canceled, unpaid, or already handed off. It is
  // terminal, so acking is right — redelivering would burn the DLQ budget on
  // a row that can never become sendable.
  it('acknowledges a send the spine refused rather than retrying it', async () => {
    mockOutreachService.model.findUnique.mockResolvedValue({
      message: 'Budget hearing Tuesday.',
      imageUrl: null,
      scheduledLocalDate: '2026-10-08',
      voterFileFilterId: 5,
    })
    mockOutreachTextDelivery.requestSend.mockResolvedValue({
      audienceResolved: false,
      recipientCount: 0,
      excludedOptedOutCount: 0,
      excludedDuplicateCount: 0,
      sendKey: '9-1.csv',
      terminalReason: 'not_sendable',
    })

    const result = await service.processMessage(
      outreachTextSendMessage({ outreachId: 9, sendSeq: 1 }),
    )

    expect(result).toBe(true)
  })

  // A send that cannot be made at all — an empty audience, a deleted saved
  // list, a missing organization — is terminal too: every redelivery reads
  // the same rows and fails the same way.
  it('acknowledges a send that failed permanently', async () => {
    mockOutreachService.model.findUnique.mockResolvedValue({
      message: 'Budget hearing Tuesday.',
      imageUrl: null,
      scheduledLocalDate: '2026-10-08',
      voterFileFilterId: 5,
    })
    mockOutreachTextDelivery.requestSend.mockResolvedValue({
      audienceResolved: false,
      recipientCount: 0,
      excludedOptedOutCount: 0,
      excludedDuplicateCount: 0,
      sendKey: '9-1.csv',
      terminalReason: 'send_failed',
    })

    const result = await service.processMessage(
      outreachTextSendMessage({ outreachId: 9, sendSeq: 1 }),
    )

    expect(result).toBe(true)
  })

  // Reusing a previous attempt's CSV also reports audienceResolved: false,
  // but with a real recipient count — that is a completed handoff, not a
  // refusal, and it must not be logged or treated as one.
  it('treats a reused CSV as a real handoff, not a refusal', async () => {
    mockOutreachService.model.findUnique.mockResolvedValue({
      message: 'Budget hearing Tuesday.',
      imageUrl: null,
      scheduledLocalDate: '2026-10-08',
      voterFileFilterId: 5,
    })
    mockOutreachTextDelivery.requestSend.mockResolvedValue({
      audienceResolved: false,
      recipientCount: 200,
      excludedOptedOutCount: 0,
      excludedDuplicateCount: 0,
      sendKey: '9-1.csv',
    })

    const result = await service.processMessage(
      outreachTextSendMessage({ outreachId: 9, sendSeq: 1 }),
    )

    expect(result).toBe(true)
  })

  it('acknowledges outreachTextSend for an outreach that no longer exists', async () => {
    mockOutreachService.model.findUnique.mockResolvedValue(null)

    const result = await service.processMessage(
      outreachTextSendMessage({ outreachId: 404, sendSeq: 1 }),
    )

    expect(result).toBe(true)
    expect(mockOutreachTextDelivery.requestSend).not.toHaveBeenCalled()
  })

  it('acknowledges a row missing the saved list, message or send date', async () => {
    mockOutreachService.model.findUnique.mockResolvedValue({
      message: 'Budget hearing Tuesday.',
      imageUrl: null,
      scheduledLocalDate: '2026-10-08',
      voterFileFilterId: null,
    })

    const result = await service.processMessage(
      outreachTextSendMessage({ outreachId: 7, sendSeq: 1 }),
    )

    expect(result).toBe(true)
    expect(mockOutreachTextDelivery.requestSend).not.toHaveBeenCalled()
  })

  // A genuine fault (S3, Slack, the database) must NOT ack: the send is
  // idempotent under redelivery and an unhandled one has to reach the DLQ.
  it('lets a delivery failure propagate so the message redelivers', async () => {
    mockOutreachService.model.findUnique.mockResolvedValue({
      message: 'Budget hearing Tuesday.',
      imageUrl: null,
      scheduledLocalDate: '2026-10-08',
      voterFileFilterId: 5,
    })
    mockOutreachTextDelivery.requestSend.mockRejectedValue(
      new Error('S3 write failed'),
    )

    await expect(
      service.processMessage(outreachTextSendMessage({ outreachId: 9 })),
    ).rejects.toThrow('S3 write failed')
  })

  // A payload the schema cannot read is our own producer's bug on a paid
  // send. It throws so it ages to the DLQ instead of being ack-dropped.
  it('refuses to acknowledge a malformed outreachTextSend payload', async () => {
    await expect(
      service.processMessage(outreachTextSendMessage({ sendSeq: 1 })),
    ).rejects.toThrow()
    expect(mockOutreachTextDelivery.requestSend).not.toHaveBeenCalled()
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

  it('routes nightly10DlcReport messages and returns the handler boolean', async () => {
    const report = module.get(Nightly10DlcReportService)
    const handleSpy = vi
      .spyOn(report, 'handleNightlyReport')
      .mockResolvedValue(true)

    const message: Message = {
      MessageId: 'msg-nightly-ok',
      Body: JSON.stringify({
        type: QueueType.NIGHTLY_10DLC_REPORT,
        data: { reportDate: '2026-07-10' },
      }),
    }

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(handleSpy).toHaveBeenCalledExactlyOnceWith({
      reportDate: '2026-07-10',
    })
  })

  it('requeues nightly10DlcReport when the handler reports a failed post', async () => {
    const report = module.get(Nightly10DlcReportService)
    vi.spyOn(report, 'handleNightlyReport').mockResolvedValue(false)

    const message: Message = {
      MessageId: 'msg-nightly-slack-fail',
      Body: JSON.stringify({
        type: QueueType.NIGHTLY_10DLC_REPORT,
        data: { reportDate: '2026-07-10' },
      }),
    }

    const result = await service.processMessage(message)

    expect(result).toBe(false)
  })

  it('routes cvStatusPoll messages to the handler and acks immediately', async () => {
    const cv = module.get(CvStatusPollService)
    // handleCvStatusPoll is intentionally synchronous fire-and-forget: it
    // detaches the paced scan and returns true so the message is acked
    // before the scan completes (the scan outlives the SQS visibility
    // timeout). The routing must return its boolean without awaiting any
    // scan work.
    const handleSpy = vi.spyOn(cv, 'handleCvStatusPoll').mockReturnValue(true)

    const message: Message = {
      MessageId: 'msg-cv-poll-ok',
      Body: JSON.stringify({
        type: QueueType.CV_STATUS_POLL,
        data: { scanKey: '2026-08-17-08' },
      }),
    }

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(handleSpy).toHaveBeenCalledExactlyOnceWith({
      scanKey: '2026-08-17-08',
    })
  })

  it('discards cvStatusPoll with invalid payload and does not start a scan', async () => {
    const cv = module.get(CvStatusPollService)
    const handleSpy = vi.spyOn(cv, 'handleCvStatusPoll')

    const message: Message = {
      MessageId: 'msg-cv-poll-invalid',
      Body: JSON.stringify({
        type: QueueType.CV_STATUS_POLL,
        data: { notScanKey: true },
      }),
    }

    // withLegacyErrorSwallowing catches the Zod parse failure and discards
    // (true) rather than redelivering a poison message forever — and no
    // unkeyed scan ever starts.
    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(handleSpy).not.toHaveBeenCalled()
  })

  it('discards nightly10DlcReport with invalid payload and does not call handler', async () => {
    const report = module.get(Nightly10DlcReportService)
    const handleSpy = vi.spyOn(report, 'handleNightlyReport')

    const message: Message = {
      MessageId: 'msg-nightly-invalid',
      Body: JSON.stringify({
        type: QueueType.NIGHTLY_10DLC_REPORT,
        data: { reportDate: 'not-a-date' },
      }),
    }

    // withLegacyErrorSwallowing catches the Zod parse failure and returns true
    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(handleSpy).not.toHaveBeenCalled()
  })

  it('routes agenticComplianceKickoff messages to the TCR compliance handler', async () => {
    const tcr = module.get(CampaignTcrComplianceService)
    const handleSpy = vi
      .spyOn(tcr, 'handleAgenticKickoff')
      .mockResolvedValue(undefined)

    const validTcrCuid = 'ckpqr7s3z00010o9k1234abcd'
    const message: Message = {
      MessageId: 'msg-kickoff-ok',
      Body: JSON.stringify({
        type: QueueType.AGENTIC_COMPLIANCE_KICKOFF,
        data: {
          campaignId: 42,
          tcrComplianceId: validTcrCuid,
          clerkUserId: 'user_clerk_xyz',
        },
      }),
    }

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(handleSpy).toHaveBeenCalledOnce()
    expect(handleSpy).toHaveBeenCalledWith({
      campaignId: 42,
      tcrComplianceId: validTcrCuid,
      clerkUserId: 'user_clerk_xyz',
    })
  })

  it('discards agenticComplianceKickoff with invalid payload and does not call handler', async () => {
    const tcr = module.get(CampaignTcrComplianceService)
    const handleSpy = vi
      .spyOn(tcr, 'handleAgenticKickoff')
      .mockResolvedValue(undefined)

    const message: Message = {
      MessageId: 'msg-kickoff-invalid',
      Body: JSON.stringify({
        type: QueueType.AGENTIC_COMPLIANCE_KICKOFF,
        data: {
          campaignId: 42,
          tcrComplianceId: 'not-a-cuid',
          clerkUserId: 'user_clerk_xyz',
        },
      }),
    }

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(handleSpy).not.toHaveBeenCalled()
  })
})

describe('QueueConsumerService - handleTcrComplianceCheckMessage', () => {
  let service: QueueConsumerService
  let mockTcrComplianceService: {
    checkUsecaseActivation: ReturnType<typeof vi.fn>
  }

  const buildMessage = (): Message => ({
    MessageId: 'msg-tcr-check',
    Body: JSON.stringify({
      type: QueueType.TCR_COMPLIANCE_STATUS_CHECK,
      data: { tcrCompliance: { peerlyIdentityId: 'peerly-999' } },
    }),
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(async () => {
    mockTcrComplianceService = {
      checkUsecaseActivation: vi.fn().mockResolvedValue(true),
    }

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        QueueConsumerService,
        { provide: CampaignsService, useValue: {} },
        {
          provide: CampaignTcrComplianceService,
          useValue: mockTcrComplianceService,
        },
        { provide: ContactsService, useValue: {} },
        { provide: ElectedOfficeService, useValue: {} },
        { provide: PollsService, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: SlackService, useValue: { message: vi.fn() } },
        { provide: UsersService, useValue: {} },
        { provide: Nightly10DlcReportService, useValue: {} },
        { provide: CvStatusPollService, useValue: {} },
        { provide: OrdinanceQualityLoopService, useValue: {} },
        { provide: OutreachService, useValue: { model: {} } },
        { provide: OutreachTextDeliveryService, useValue: {} },
        { provide: OutreachServePollExpansionService, useValue: {} },
        { provide: P2pPhoneListUploadService, useValue: {} },
        { provide: PinoLogger, useValue: createMockLogger() },
        { provide: OutreachTextSendFundingService, useValue: {} },
        { provide: EmailOutreachQueueService, useValue: {} },
        { provide: JobsService, useValue: {} },
      ],
    }).compile()
    service = mod.get(QueueConsumerService)
  })

  // The body lives in CampaignTcrComplianceService.checkUsecaseActivation
  // (covered in campaignTcrCompliance.service.test.ts); the consumer only
  // delegates and returns its ack.
  it('delegates to checkUsecaseActivation and returns its ack', async () => {
    const result = await service.processMessage(buildMessage())

    expect(result).toBe(true)
    expect(
      mockTcrComplianceService.checkUsecaseActivation,
    ).toHaveBeenCalledWith({ peerlyIdentityId: 'peerly-999' })
  })
})

describe('QueueConsumerService - ORDINANCE_QUALITY_LOOP', () => {
  const buildService = (enqueueStep: ReturnType<typeof vi.fn>) =>
    new QueueConsumerService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { enqueueStep } as never,
      {} as never,
      {} as never,
      {} as never,
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
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createMockLogger(),
      {} as never,
      {} as never,
      { sendMany } as never,
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
