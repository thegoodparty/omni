import { readFileSync } from 'fs'
import { join } from 'path'
import { InternalServerErrorException } from '@nestjs/common'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { MeetingBriefingsService } from '@/meetings/services/meetingBriefings.service'
import { CampaignStrategyService } from '@/campaignStrategy/services/campaignStrategy.service'
import { RaceOpponentPersistService } from '@/raceOpponent/services/raceOpponentPersist.service'
import { RaceOpponentResearchPersistService } from '@/raceOpponent/services/raceOpponentResearchPersist.service'
import { AnnotationAttachmentService } from '@/annotations/services/annotationAttachment.service'
import { CommunityIssueService } from '@/communityIssues/services/communityIssue.service'
import { OrdinanceCodePersistService } from '@/ordinances/services/ordinanceCodePersist.service'
import { OrdinanceQualityLoopService } from '@/ordinances/services/ordinanceQualityLoop.service'
import { RecommendedListsComputeService } from '@/recommendedLists/services/recommendedListsCompute.service'
import { AiContentService } from '@/campaigns/ai/content/aiContent.service'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { AiGenerationService } from '@/campaigns/tasks/services/aiGeneration.service'
import { CampaignTasksService } from '@/campaigns/tasks/services/campaignTasks.service'
import { CampaignTrackerTasksService } from '@/campaigns/campaignTracker/services/campaignTrackerTasks.service'
import { WeeklyTasksDigestHandlerService } from '@/campaigns/tasks/services/weeklyTasksDigestHandler.service'
import { Nightly10DlcReportService } from '@/campaigns/tcrCompliance/services/nightly10DlcReport.service'
import { CvStatusPollService } from '@/campaigns/tcrCompliance/services/cvStatusPoll.service'
import { CampaignTcrComplianceService } from '@/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { PollIndividualMessageService } from '@/polls/services/pollIndividualMessage.service'
import { PollIssuesService } from '@/polls/services/pollIssues.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PinoLogger } from 'nestjs-pino'
import { UsersService } from '@/users/services/users.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { DomainsService } from '@/websites/services/domains.service'
import { Test, TestingModule } from '@nestjs/testing'
import type { Message } from '@aws-sdk/client-sqs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { PollsService } from 'src/polls/services/polls.service'
import type { PollResponseJsonRow } from '../queue.types'
import { QueueType } from '../queue.types'
import { QueueConsumerService } from './queueConsumer.service'

vi.mock('@/polls/utils/polls.utils', async (importOriginal) => ({
  ...(await importOriginal()),
  sendTevynAPIPollMessage: vi.fn(),
}))

const createPollAnalysisCompleteMessage = (data: {
  pollId: string
  totalResponses?: number
  responsesLocation?: string
  issues?: Array<{
    pollId: string
    rank: number
    theme: string
    summary: string
    analysis: string
    responseCount: number
    quotes: Array<{ quote: string; phone_number: string }>
  }>
}): Message => ({
  MessageId: 'msg-1',
  Body: JSON.stringify({
    type: QueueType.POLL_ANALYSIS_COMPLETE,
    data: {
      pollId: data.pollId,
      totalResponses: data.totalResponses ?? 10,
      responsesLocation:
        data.responsesLocation ?? 'polls/poll-1/all_cluster_analysis.json',
      issues: data.issues ?? [
        {
          pollId: data.pollId,
          rank: 1,
          theme: 'Theme A',
          summary: 'Summary A',
          analysis: 'Analysis A',
          responseCount: 5,
          quotes: [{ quote: 'Q1', phone_number: '+15551234567' }],
        },
      ],
    },
  }),
})

/** Fills required fields so partial test rows satisfy PollResponseJsonRow. */
const toFullRow = (
  r: Partial<PollResponseJsonRow> & {
    phoneNumber: string
    receivedAt: string
    originalMessage: string
    clusterId: number | string
  },
): PollResponseJsonRow => ({
  atomicId: '',
  atomicMessage: '',
  pollId: '',
  theme: '',
  category: '',
  summary: '',
  sentiment: '',
  isOptOut: false,
  ...r,
})

const createPollAnalysisJson = (
  responses: Parameters<typeof toFullRow>[0][],
): string => JSON.stringify(responses.map(toFullRow))

describe('QueueConsumerService - handlePollAnalysisComplete', () => {
  let service: QueueConsumerService
  let pollsService: {
    findUnique: ReturnType<typeof vi.fn>
    markPollComplete: ReturnType<typeof vi.fn>
    model: { count: ReturnType<typeof vi.fn> }
  }
  let electedOfficeService: {
    findUnique: ReturnType<typeof vi.fn>
    client: {
      electedOffice: { findUnique: ReturnType<typeof vi.fn> }
    }
  }
  let campaignsService: { findUnique: ReturnType<typeof vi.fn> }
  let contactsService: {
    findContacts: ReturnType<typeof vi.fn>
    findPersonByPhone: ReturnType<typeof vi.fn>
    resolveProAccess: ReturnType<typeof vi.fn>
  }
  let pollIssuesService: {
    model: { deleteMany: ReturnType<typeof vi.fn> }
    client: { pollIssue: { createMany: ReturnType<typeof vi.fn> } }
  }
  let s3Service: { getFile: ReturnType<typeof vi.fn> }
  let pollIndividualMessage: {
    findMany: ReturnType<typeof vi.fn>
    client: { $transaction: ReturnType<typeof vi.fn> }
  }
  let analytics: {
    identify: ReturnType<typeof vi.fn>
    track: ReturnType<typeof vi.fn>
  }

  const pollId = 'poll-123'
  const electedOfficeId = 'office-1'
  const officeUserId = 1
  const personId = 'person-1'
  const phoneNumber = '+15551234567'

  beforeEach(() => {
    vi.stubEnv('SERVE_ANALYSIS_BUCKET_NAME', 'test-analysis-bucket')
    const mockFindUniquePoll = vi.fn().mockResolvedValue({
      id: pollId,
      electedOfficeId,
      isCompleted: false,
      scheduledDate: new Date('2020-01-01'),
      targetAudienceSize: 500,
    })
    pollsService = {
      findUnique: mockFindUniquePoll,
      markPollComplete: vi.fn().mockResolvedValue(undefined),
      model: { count: vi.fn().mockResolvedValue(1) },
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
    campaignsService = {
      findUnique: vi.fn(),
    }
    contactsService = {
      findContacts: vi
        .fn()
        .mockResolvedValue({ pagination: { totalResults: 100 } }),
      findPersonByPhone: vi.fn().mockResolvedValue(null),
      resolveProAccess: vi.fn().mockResolvedValue(true),
    }
    pollIssuesService = {
      model: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      client: {
        pollIssue: { createMany: vi.fn().mockResolvedValue(undefined) },
      },
    }
    s3Service = { getFile: vi.fn() }
    pollIndividualMessage = {
      findMany: vi
        .fn()
        .mockResolvedValue([{ personCellPhone: phoneNumber, personId }]),
      client: {
        $transaction: vi
          .fn()
          .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
            const mockTx = {
              pollIndividualMessage: {
                deleteMany: vi.fn().mockResolvedValue(undefined),
                createMany: vi.fn().mockResolvedValue(undefined),
              },
              $executeRaw: vi.fn().mockResolvedValue(undefined),
            }
            return fn(mockTx)
          }),
      },
    }
    analytics = {
      identify: vi.fn().mockResolvedValue(undefined),
      track: vi.fn().mockResolvedValue(undefined),
    }

    service = new QueueConsumerService(
      {} as never,
      {} as never,
      analytics as unknown as AnalyticsService,
      campaignsService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      pollsService as unknown as PollsService,
      pollIssuesService as never,
      pollIndividualMessage as never,
      electedOfficeService as never,
      contactsService as never,
      s3Service as never,
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
      {} as never,
      createMockLogger(),
    )
  })

  it('acks and does not create messages when poll is not found', async () => {
    pollsService.findUnique.mockResolvedValue(null)
    const message = createPollAnalysisCompleteMessage({ pollId })

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(s3Service.getFile).not.toHaveBeenCalled()
    expect(pollIssuesService.model.deleteMany).not.toHaveBeenCalled()
  })

  it('acks and does not create messages when poll is not SCHEDULED or IN_PROGRESS', async () => {
    pollsService.findUnique.mockResolvedValue({
      id: pollId,
      electedOfficeId,
      isCompleted: true,
      scheduledDate: new Date('2020-01-01'),
    })
    const message = createPollAnalysisCompleteMessage({ pollId })

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(s3Service.getFile).not.toHaveBeenCalled()
  })

  it('throws when S3 getFile returns null', async () => {
    s3Service.getFile.mockResolvedValue(null)
    const message = createPollAnalysisCompleteMessage({ pollId })

    await expect(service.processMessage(message)).rejects.toThrow(
      InternalServerErrorException,
    )
    await expect(service.processMessage(message)).rejects.toThrow(
      /Unable to fetch responses from S3/,
    )
  })

  it('skips response and completes poll when phone is in neither outreach nor People DB (no poison pill)', async () => {
    pollIndividualMessage.findMany.mockResolvedValue([])
    contactsService.findPersonByPhone.mockResolvedValue(null)
    const json = createPollAnalysisJson([
      {
        phoneNumber: '+15559999999',
        receivedAt: '2024-01-15T10:00:00Z',
        originalMessage: 'Hello',
        clusterId: 1,
      },
    ])
    s3Service.getFile.mockResolvedValue(json)
    const message = createPollAnalysisCompleteMessage({ pollId })

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(contactsService.findPersonByPhone).toHaveBeenCalledWith(
      '5559999999',
      expect.anything(),
      expect.anything(),
    )
    expect(pollIndividualMessage.client.$transaction).toHaveBeenCalled()
    const txCb = firstOrThrow(
      pollIndividualMessage.client.$transaction.mock.calls,
    )[0]
    const mockTx = {
      pollIndividualMessage: { deleteMany: vi.fn(), createMany: vi.fn() },
      $executeRaw: vi.fn(),
    }
    await txCb(mockTx)
    expect(mockTx.pollIndividualMessage.createMany).toHaveBeenCalledWith({
      data: [],
    })
    expect(pollsService.markPollComplete).toHaveBeenCalled()
  })

  it('falls back to People DB when phone is missing from outreach and persists with the matched personId', async () => {
    pollIndividualMessage.findMany.mockResolvedValue([])
    contactsService.findPersonByPhone.mockResolvedValue({
      id: 'people-db-person-1',
    })
    const json = createPollAnalysisJson([
      {
        phoneNumber: '+15559999999',
        receivedAt: '2024-01-15T10:00:00Z',
        originalMessage: 'Forwarded reply',
        clusterId: 1,
      },
    ])
    s3Service.getFile.mockResolvedValue(json)
    const message = createPollAnalysisCompleteMessage({ pollId })

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(contactsService.findPersonByPhone).toHaveBeenCalledWith(
      '5559999999',
      expect.anything(),
      expect.anything(),
    )
    const txCb = firstOrThrow(
      pollIndividualMessage.client.$transaction.mock.calls,
    )[0]
    const mockTx = {
      pollIndividualMessage: { deleteMany: vi.fn(), createMany: vi.fn() },
      $executeRaw: vi.fn(),
    }
    await txCb(mockTx)
    expect(mockTx.pollIndividualMessage.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          personId: 'people-db-person-1',
          content: 'Forwarded reply',
        }),
      ]),
    })
  })

  it('maps each unmapped phone to its own person regardless of lookup resolution order (bounded fan-out is order-independent)', async () => {
    pollIndividualMessage.findMany.mockResolvedValue([])

    const phones = Array.from(
      { length: 40 },
      (_, i) => `+1555${String(i).padStart(7, '0')}`,
    )
    const expectedPersonId = (normalized: string): string =>
      `person-${normalized.replace(/^\+1/, '')}`

    // Resolve out of order: later phones resolve first. If the fan-out ever
    // mismatched a result to the wrong phone (e.g. by relying on completion
    // order), this shuffled timing would surface it.
    contactsService.findPersonByPhone.mockImplementation(
      async (digitsOnly: string) => {
        const index = Number(digitsOnly.slice(-4))
        await new Promise((resolve) =>
          setTimeout(resolve, (phones.length - index) % 7),
        )
        return { id: `person-${digitsOnly}` }
      },
    )

    const json = createPollAnalysisJson(
      phones.map((phoneNumber, i) => ({
        phoneNumber,
        receivedAt: `2024-01-15T10:00:${String(i).padStart(2, '0')}Z`,
        originalMessage: `Reply ${i}`,
        clusterId: 1,
      })),
    )
    s3Service.getFile.mockResolvedValue(json)
    const message = createPollAnalysisCompleteMessage({ pollId })

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    // Pro-access resolved once, not once per phone.
    expect(contactsService.resolveProAccess).toHaveBeenCalledTimes(1)
    expect(contactsService.findPersonByPhone).toHaveBeenCalledTimes(
      phones.length,
    )

    const txCb = firstOrThrow(
      pollIndividualMessage.client.$transaction.mock.calls,
    )[0]
    const captured: Array<{ personCellPhone: string; personId: string }> = []
    const mockTx = {
      pollIndividualMessage: {
        deleteMany: vi.fn(),
        createMany: vi.fn((args: { data: typeof captured }) => {
          captured.push(...args.data)
        }),
      },
      $executeRaw: vi.fn(),
    }
    await txCb(mockTx)

    const mapping = new Map(
      captured.map((row) => [row.personCellPhone, row.personId]),
    )
    expect(mapping.size).toBe(phones.length)
    for (const normalized of phones) {
      expect(mapping.get(normalized)).toBe(expectedPersonId(normalized))
    }
  })

  it('does not call People DB fallback when every response phone maps to outreach', async () => {
    const json = createPollAnalysisJson([
      {
        phoneNumber,
        receivedAt: '2024-01-15T10:00:00Z',
        originalMessage: 'Hi',
        clusterId: 1,
      },
    ])
    s3Service.getFile.mockResolvedValue(json)
    const message = createPollAnalysisCompleteMessage({ pollId })

    await service.processMessage(message)

    expect(contactsService.findPersonByPhone).not.toHaveBeenCalled()
  })

  it('skips response when People DB lookup throws (e.g. district unresolved) — still no poison pill', async () => {
    pollIndividualMessage.findMany.mockResolvedValue([])
    contactsService.findPersonByPhone.mockRejectedValue(
      new Error(
        'Organization does not have sufficient data to resolve district',
      ),
    )
    const json = createPollAnalysisJson([
      {
        phoneNumber: '+15559999999',
        receivedAt: '2024-01-15T10:00:00Z',
        originalMessage: 'Hello',
        clusterId: 1,
      },
    ])
    s3Service.getFile.mockResolvedValue(json)
    const message = createPollAnalysisCompleteMessage({ pollId })

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    const txCb = firstOrThrow(
      pollIndividualMessage.client.$transaction.mock.calls,
    )[0]
    const mockTx = {
      pollIndividualMessage: { deleteMany: vi.fn(), createMany: vi.fn() },
      $executeRaw: vi.fn(),
    }
    await txCb(mockTx)
    expect(mockTx.pollIndividualMessage.createMany).toHaveBeenCalledWith({
      data: [],
    })
  })

  it('creates poll issues, coalesces JSON rows by phone+receivedAt, creates messages and links by clusterId', async () => {
    const json = createPollAnalysisJson([
      {
        phoneNumber,
        receivedAt: '2024-01-15T10:00:00Z',
        originalMessage: 'My response',
        clusterId: 4,
      },
      {
        phoneNumber,
        receivedAt: '2024-01-15T10:00:00Z',
        originalMessage: 'My response',
        clusterId: 16,
        isOptOut: true,
      },
    ])
    s3Service.getFile.mockResolvedValue(json)
    const message = createPollAnalysisCompleteMessage({
      pollId,
      issues: [
        {
          pollId,
          rank: 1,
          theme: 'Theme 1',
          summary: 'S1',
          analysis: 'A1',
          responseCount: 1,
          quotes: [],
        },
        {
          pollId,
          rank: 2,
          theme: 'Theme 2',
          summary: 'S2',
          analysis: 'A2',
          responseCount: 1,
          quotes: [],
        },
      ],
    })

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(pollIssuesService.model.deleteMany).toHaveBeenCalledWith({
      where: { pollId },
    })
    expect(pollIssuesService.client.pollIssue.createMany).toHaveBeenCalled()
    expect(pollIndividualMessage.client.$transaction).toHaveBeenCalled()
    const txCb = firstOrThrow(
      pollIndividualMessage.client.$transaction.mock.calls,
    )[0]
    const mockTx = {
      pollIndividualMessage: { deleteMany: vi.fn(), createMany: vi.fn() },
      $executeRaw: vi.fn(),
    }
    await txCb(mockTx)
    expect(mockTx.pollIndividualMessage.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          personId,
          pollId,
          electedOfficeId,
          content: 'My response',
          isOptOut: true,
        }),
      ]),
    })
  })

  it('respects isOptOut true in JSON', async () => {
    const json = createPollAnalysisJson([
      {
        phoneNumber,
        receivedAt: '2024-01-15T10:00:00Z',
        originalMessage: 'Ok',
        clusterId: 1,
        isOptOut: true,
      },
    ])
    s3Service.getFile.mockResolvedValue(json)
    const message = createPollAnalysisCompleteMessage({ pollId })

    await service.processMessage(message)

    const txCb = firstOrThrow(
      pollIndividualMessage.client.$transaction.mock.calls,
    )[0]
    const mockTx = {
      pollIndividualMessage: { deleteMany: vi.fn(), createMany: vi.fn() },
      $executeRaw: vi.fn(),
    }
    await txCb(mockTx)
    expect(mockTx.pollIndividualMessage.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          isOptOut: true,
        }),
      ]),
    })
  })

  it('calls markPollComplete and analytics.identify/track with issue and metadata properties', async () => {
    const json = createPollAnalysisJson([
      {
        phoneNumber,
        receivedAt: '2024-01-15T10:00:00Z',
        originalMessage: 'Hi',
        clusterId: 1,
        isOptOut: false,
      },
    ])
    s3Service.getFile.mockResolvedValue(json)
    const issues = [
      {
        pollId,
        rank: 1 as const,
        theme: 'Infrastructure',
        summary: 'Roads and bridges need repair',
        analysis: 'Detailed analysis of infrastructure',
        responseCount: 25,
        quotes: [
          { quote: 'Fix the potholes', phone_number: '+15551111111' },
          { quote: 'Bridge is unsafe', phone_number: '+15552222222' },
        ],
      },
      {
        pollId,
        rank: 2 as const,
        theme: 'Education',
        summary: 'Schools need more funding',
        analysis: 'Detailed analysis of education',
        responseCount: 15,
        quotes: [
          { quote: 'We need better teachers', phone_number: '+15553333333' },
        ],
      },
    ]
    const message = createPollAnalysisCompleteMessage({
      pollId,
      totalResponses: 50,
      issues,
    })

    await service.processMessage(message)

    expect(pollsService.markPollComplete).toHaveBeenCalledWith({
      pollId,
      totalResponses: 50,
      confidence: expect.any(String),
    })
    expect(analytics.identify).toHaveBeenCalledWith(
      officeUserId,
      expect.objectContaining({ pollcount: expect.any(Number) }),
    )
    expect(analytics.track).toHaveBeenCalledWith(
      officeUserId,
      expect.any(String),
      expect.objectContaining({
        pollId,
        'issue 1': 'Infrastructure',
        'issue 2': 'Education',
        'issue 3': null,
        issue1Description: 'Roads and bridges need repair',
        issue1Quote1: 'Fix the potholes',
        issue1Quote2: 'Bridge is unsafe',
        issue1Quote3: '',
        issue1MentionCount: 25,
        issue2Description: 'Schools need more funding',
        issue2Quote1: 'We need better teachers',
        issue2Quote2: '',
        issue2Quote3: '',
        issue2MentionCount: 15,
        issue3Description: null,
        issue3Quote1: null,
        issue3Quote2: null,
        issue3Quote3: null,
        issue3MentionCount: null,
        pollsSent: 500,
        pollResponses: 50,
        pollResponseRate: '10.0%',
      }),
    )
  })

  it('sets pollResponseRate to 0% when totalResponses is 0', async () => {
    const json = createPollAnalysisJson([
      {
        phoneNumber,
        receivedAt: '2024-01-15T10:00:00Z',
        originalMessage: 'STOP',
        clusterId: '',
        isOptOut: true,
      },
    ])
    s3Service.getFile.mockResolvedValue(json)
    const message = createPollAnalysisCompleteMessage({
      pollId,
      totalResponses: 0,
      issues: [],
    })

    await service.processMessage(message)

    expect(analytics.track).toHaveBeenCalledWith(
      officeUserId,
      expect.any(String),
      expect.objectContaining({
        pollResponses: 0,
        pollResponseRate: '0%',
      }),
    )
  })

  it('processes real-data-shaped JSON (array root, clusterId number or empty string)', async () => {
    const fixturePath = join(
      __dirname,
      'fixtures',
      'all_cluster_analysis_sample.json',
    )
    const fixtureContent = readFileSync(fixturePath, 'utf-8')
    const fixturePollId = '019c29d4-81aa-733e-a72a-3983baf19a22'
    const fixturePhones = ['12088508796', '12088639774', '12817265015']

    pollsService.findUnique.mockResolvedValue({
      id: fixturePollId,
      electedOfficeId,
      isCompleted: false,
      scheduledDate: new Date('2020-01-01'),
    })
    pollIndividualMessage.findMany.mockResolvedValue(
      fixturePhones.map((phone, i) => ({
        personCellPhone: phone,
        personId: `person-fixture-${i + 1}`,
      })),
    )
    s3Service.getFile.mockResolvedValue(fixtureContent)

    const message = createPollAnalysisCompleteMessage({
      pollId: fixturePollId,
      totalResponses: 4,
      issues: [
        {
          pollId: fixturePollId,
          rank: 1,
          theme: 'T1',
          summary: 'S1',
          analysis: 'A1',
          responseCount: 1,
          quotes: [],
        },
        {
          pollId: fixturePollId,
          rank: 2,
          theme: 'T2',
          summary: 'S2',
          analysis: 'A2',
          responseCount: 1,
          quotes: [],
        },
      ],
    })

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(pollIssuesService.model.deleteMany).toHaveBeenCalledWith({
      where: { pollId: fixturePollId },
    })
    expect(pollIndividualMessage.client.$transaction).toHaveBeenCalled()
    const txCb = firstOrThrow(
      pollIndividualMessage.client.$transaction.mock.calls,
    )[0]
    const mockTx = {
      pollIndividualMessage: { deleteMany: vi.fn(), createMany: vi.fn() },
      $executeRaw: vi.fn(),
    }
    await txCb(mockTx)
    // Fixture has 3 unique groups (phone+receivedAt): opt-out, single-row traffic, two-row community/biking
    expect(mockTx.pollIndividualMessage.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          personId: 'person-fixture-1',
          content: 'STOP',
          isOptOut: true,
        }),
        expect.objectContaining({
          personId: 'person-fixture-2',
          content: 'Traffic',
          isOptOut: false,
        }),
        expect.objectContaining({
          personId: 'person-fixture-3',
          content: expect.stringContaining('Community development'),
          isOptOut: false,
        }),
      ]),
    })
    expect(
      firstOrThrow(mockTx.pollIndividualMessage.createMany.mock.calls)[0].data,
    ).toHaveLength(3)
  })

  it('discards responses that have no clusterId and are not opt-outs', async () => {
    const json = createPollAnalysisJson([
      {
        phoneNumber,
        receivedAt: '2024-01-15T10:00:00Z',
        originalMessage: 'irrelevant noise',
        clusterId: '',
        isOptOut: false,
      },
    ])
    s3Service.getFile.mockResolvedValue(json)
    const message = createPollAnalysisCompleteMessage({ pollId })

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    const txCb = firstOrThrow(
      pollIndividualMessage.client.$transaction.mock.calls,
    )[0]
    const mockTx = {
      pollIndividualMessage: { deleteMany: vi.fn(), createMany: vi.fn() },
      $executeRaw: vi.fn(),
    }
    await txCb(mockTx)
    expect(mockTx.pollIndividualMessage.createMany).toHaveBeenCalledWith({
      data: [],
    })
  })

  it('keeps opt-out responses even when they have no clusterId', async () => {
    const json = createPollAnalysisJson([
      {
        phoneNumber,
        receivedAt: '2024-01-15T10:00:00Z',
        originalMessage: 'STOP',
        clusterId: '',
        isOptOut: true,
      },
    ])
    s3Service.getFile.mockResolvedValue(json)
    const message = createPollAnalysisCompleteMessage({ pollId })

    await service.processMessage(message)

    const txCb = firstOrThrow(
      pollIndividualMessage.client.$transaction.mock.calls,
    )[0]
    const mockTx = {
      pollIndividualMessage: { deleteMany: vi.fn(), createMany: vi.fn() },
      $executeRaw: vi.fn(),
    }
    await txCb(mockTx)
    expect(mockTx.pollIndividualMessage.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          isOptOut: true,
          content: 'STOP',
        }),
      ]),
    })
    expect(
      firstOrThrow(mockTx.pollIndividualMessage.createMany.mock.calls)[0].data,
    ).toHaveLength(1)
    // No join records should be created for opt-out without clusterId
    expect(mockTx.$executeRaw).not.toHaveBeenCalled()
  })

  it('saves responses with a clusterId outside the top 3 but without a poll issue link', async () => {
    const json = createPollAnalysisJson([
      {
        phoneNumber,
        receivedAt: '2024-01-15T10:00:00Z',
        originalMessage: 'My niche concern',
        clusterId: 5,
        isOptOut: false,
      },
    ])
    s3Service.getFile.mockResolvedValue(json)
    const message = createPollAnalysisCompleteMessage({
      pollId,
      issues: [
        {
          pollId,
          rank: 1,
          theme: 'Top issue',
          summary: 'S1',
          analysis: 'A1',
          responseCount: 3,
          quotes: [],
        },
      ],
    })

    await service.processMessage(message)

    const txCb = firstOrThrow(
      pollIndividualMessage.client.$transaction.mock.calls,
    )[0]
    const mockTx = {
      pollIndividualMessage: { deleteMany: vi.fn(), createMany: vi.fn() },
      $executeRaw: vi.fn(),
    }
    await txCb(mockTx)
    // The individual message is still created
    expect(
      firstOrThrow(mockTx.pollIndividualMessage.createMany.mock.calls)[0].data,
    ).toHaveLength(1)
    expect(mockTx.pollIndividualMessage.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          content: 'My niche concern',
        }),
      ]),
    })
    // But no join record is created since clusterId 5 is not in the top 3
    expect(mockTx.$executeRaw).not.toHaveBeenCalled()
  })

  it('is idempotent: processing the same poll analysis complete event twice succeeds both times', async () => {
    const json = createPollAnalysisJson([
      {
        phoneNumber,
        receivedAt: '2024-01-15T10:00:00Z',
        originalMessage: 'Same response',
        clusterId: 1,
      },
    ])
    s3Service.getFile.mockResolvedValue(json)
    const message = createPollAnalysisCompleteMessage({ pollId })

    const first = await service.processMessage(message)
    const second = await service.processMessage(message)

    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(pollIndividualMessage.client.$transaction).toHaveBeenCalledTimes(2)

    const txCb = firstOrThrow(
      pollIndividualMessage.client.$transaction.mock.calls,
    )[0]
    const mockTx = {
      pollIndividualMessage: { deleteMany: vi.fn(), createMany: vi.fn() },
      $executeRaw: vi.fn(),
    }
    await txCb(mockTx)
    expect(mockTx.pollIndividualMessage.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: expect.any(Array) },
        pollId,
        sender: expect.anything(),
      },
    })
    const deleteWhere = firstOrThrow(
      mockTx.pollIndividualMessage.deleteMany.mock.calls,
    )[0].where
    expect(deleteWhere.id.in).toHaveLength(1)
    expect(mockTx.pollIndividualMessage.createMany).toHaveBeenCalled()
  })
})

describe('QueueConsumerService - handleDomainEmailForwardingMessage', () => {
  let service: QueueConsumerService
  let domainsService: {
    shouldEnableDomainPurchase: ReturnType<typeof vi.fn>
    setupDomainEmailForwarding: ReturnType<typeof vi.fn>
    model: {
      findUniqueOrThrow: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
    }
  }

  const domain = { id: 123, name: 'example.org' }

  beforeEach(() => {
    domainsService = {
      shouldEnableDomainPurchase: vi.fn().mockReturnValue(true),
      setupDomainEmailForwarding: vi.fn().mockResolvedValue({
        id: 'fed_123',
        name: domain.name,
        verification_record: 'verify_123',
      }),
      model: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(domain),
        update: vi.fn().mockResolvedValue(undefined),
      },
    }

    service = new QueueConsumerService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      domainsService as unknown as DomainsService,
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
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createMockLogger(),
    )
  })

  it('persists emailForwardingDomainId when setupDomainEmailForwarding succeeds', async () => {
    const message: Message = {
      MessageId: 'msg-domain-success',
      Body: JSON.stringify({
        type: QueueType.DOMAIN_EMAIL_FORWARDING,
        data: { domainId: domain.id },
      }),
    }

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(domainsService.setupDomainEmailForwarding).toHaveBeenCalledWith(
      domain,
    )
    expect(domainsService.model.update).toHaveBeenCalledWith({
      where: { id: domain.id },
      data: { emailForwardingDomainId: 'fed_123' },
    })
  })

  it('throws when shouldEnableDomainPurchase is false', async () => {
    domainsService.shouldEnableDomainPurchase.mockReturnValue(false)
    const handler = Reflect.get(
      service,
      'handleDomainEmailForwardingMessage',
    ) as ((data: { domainId: number }) => Promise<boolean>) | undefined

    await expect(
      Reflect.apply(handler!, service, [{ domainId: domain.id }]),
    ).rejects.toThrow(
      `Domain purchasing is disabled - skipping backfill for domainId: ${domain.id}`,
    )
  })

  it('re-throws expected error message when setupDomainEmailForwarding fails', async () => {
    domainsService.setupDomainEmailForwarding.mockRejectedValue(
      new Error('forwarding provider failed'),
    )
    const handler = Reflect.get(
      service,
      'handleDomainEmailForwardingMessage',
    ) as ((data: { domainId: number }) => Promise<boolean>) | undefined

    await expect(
      Reflect.apply(handler!, service, [{ domainId: domain.id }]),
    ).rejects.toThrow(
      `Error setting up email forwarding for domain *@${domain.name}`,
    )
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
  let campaignsService: { findUnique: ReturnType<typeof vi.fn> }
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
    campaignsService = {
      findUnique: vi.fn(),
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
      {} as never,
      { client: {} } as never,
      {} as never,
      campaignsService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      pollsService as never,
      {} as never,
      {} as never,
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
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createMockLogger(),
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

  beforeEach(async () => {
    mockCampaignsService = { model: { findUniqueOrThrow: vi.fn() } }
    mockSlackService = { message: vi.fn() }

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        QueueConsumerService,
        { provide: AiContentService, useValue: {} },
        { provide: CampaignsService, useValue: mockCampaignsService },
        {
          provide: AiGenerationService,
          useValue: {
            parseCompletionResult: vi
              .fn()
              .mockResolvedValue({ campaignId: 123, tasks: [] }),
          },
        },
        {
          provide: CampaignTasksService,
          useValue: {
            addEventTasks: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CampaignTcrComplianceService,
          useValue: {
            handleAgenticKickoff: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: ContactsService, useValue: {} },
        { provide: DomainsService, useValue: {} },
        { provide: ElectedOfficeService, useValue: {} },
        { provide: OrganizationsService, useValue: {} },
        { provide: PollIndividualMessageService, useValue: { client: {} } },
        { provide: PollIssuesService, useValue: {} },
        { provide: PollsService, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: SlackService, useValue: mockSlackService },
        { provide: UsersService, useValue: {} },
        { provide: AnalyticsService, useValue: {} },
        {
          provide: WeeklyTasksDigestHandlerService,
          useValue: { handleWeeklyTasksDigest: vi.fn() },
        },
        {
          provide: Nightly10DlcReportService,
          useValue: { handleNightlyReport: vi.fn().mockResolvedValue(true) },
        },
        {
          provide: CvStatusPollService,
          useValue: { handleCvStatusPoll: vi.fn().mockReturnValue(true) },
        },
        { provide: ExperimentRunsService, useValue: {} },
        {
          provide: MeetingBriefingsService,
          useValue: {
            onExperimentRunCompleted: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CommunityIssueService,
          useValue: {
            onExperimentRunCompleted: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CampaignStrategyService,
          useValue: { onExperimentRunCompleted: vi.fn() },
        },
        {
          provide: CampaignTrackerTasksService,
          useValue: { onExperimentRunCompleted: vi.fn() },
        },
        {
          provide: RaceOpponentPersistService,
          useValue: { onExperimentRunCompleted: vi.fn() },
        },
        {
          provide: RaceOpponentResearchPersistService,
          useValue: { onExperimentRunCompleted: vi.fn() },
        },
        {
          provide: OrdinanceCodePersistService,
          useValue: { onExperimentRunCompleted: vi.fn() },
        },
        {
          provide: OrdinanceQualityLoopService,
          useValue: { handleStep: vi.fn() },
        },
        {
          provide: AnnotationAttachmentService,
          useValue: { runOcr: vi.fn() },
        },
        {
          provide: RecommendedListsComputeService,
          useValue: { handleRecompute: vi.fn() },
        },
        { provide: PinoLogger, useValue: createMockLogger() },
      ],
    }).compile()
    module = mod
    service = module.get(QueueConsumerService)
  })

  it('processes campaignPlanComplete and calls handleCampaignPlanComplete', async () => {
    const message: Message = {
      MessageId: 'msg-plan-complete',
      Body: JSON.stringify({
        type: QueueType.CAMPAIGN_PLAN_COMPLETE,
        data: {
          campaignId: 123,
          status: 'completed',
          s3Key: 'results/123/test.json',
          taskCount: 10,
        },
      }),
    }

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(mockSlackService.message).not.toHaveBeenCalled()
  })

  it('skips Slack notification on campaignPlanComplete error status', async () => {
    const message: Message = {
      MessageId: 'msg-plan-error',
      Body: JSON.stringify({
        type: QueueType.CAMPAIGN_PLAN_COMPLETE,
        data: {
          campaignId: 123,
          status: 'error',
          error: 'generation failed',
        },
      }),
    }

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(mockCampaignsService.model.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(mockSlackService.message).not.toHaveBeenCalled()
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

  it('routes ordinanceQualityLoop messages to the loop handler', async () => {
    const loop = module.get(OrdinanceQualityLoopService)
    const handleSpy = vi.spyOn(loop, 'handleStep').mockResolvedValue(true)
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
    expect(handleSpy).toHaveBeenCalledWith(data)
  })

  it('propagates a requeue signal from the loop handler', async () => {
    const loop = module.get(OrdinanceQualityLoopService)
    vi.spyOn(loop, 'handleStep').mockResolvedValue(false)

    const result = await service.processMessage({
      MessageId: 'msg-quality-loop-requeue',
      Body: JSON.stringify({
        type: QueueType.ORDINANCE_QUALITY_LOOP,
        data: {
          ordinanceId: 'ord-1',
          loopRunId: 'run-1',
          iteration: 1,
          phase: 'revise',
          expectedInputHash: 'hash-2',
          attempt: 1,
        },
      }),
    })

    expect(result).toBe(false)
  })

  it('routes weeklyTasksDigest messages to the handler', async () => {
    const handler = module.get(WeeklyTasksDigestHandlerService)
    const handleSpy = vi
      .spyOn(handler, 'handleWeeklyTasksDigest')
      .mockResolvedValue(undefined)

    const message: Message = {
      MessageId: 'msg-digest-ok',
      Body: JSON.stringify({
        type: QueueType.WEEKLY_TASKS_DIGEST,
        data: {
          windowStart: '2026-04-20T00:00:00.000Z',
          windowEnd: '2026-04-27T00:00:00.000Z',
        },
      }),
    }

    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(handleSpy).toHaveBeenCalledOnce()
    expect(handleSpy).toHaveBeenCalledWith({
      windowStart: '2026-04-20T00:00:00.000Z',
      windowEnd: '2026-04-27T00:00:00.000Z',
    })
  })

  it('rejects weeklyTasksDigest messages with invalid payload and does not call handler', async () => {
    const handler = module.get(WeeklyTasksDigestHandlerService)
    const handleSpy = vi
      .spyOn(handler, 'handleWeeklyTasksDigest')
      .mockResolvedValue(undefined)

    const message: Message = {
      MessageId: 'msg-digest-invalid',
      Body: JSON.stringify({
        type: QueueType.WEEKLY_TASKS_DIGEST,
        data: {
          windowStart: 'not-a-date',
        },
      }),
    }

    // withLegacyErrorSwallowing catches the Zod parse failure and returns true
    const result = await service.processMessage(message)

    expect(result).toBe(true)
    expect(handleSpy).not.toHaveBeenCalled()
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

  it('discards campaignPlanComplete with permanent Prisma error instead of requeuing', async () => {
    const campaignTasksService = module.get(CampaignTasksService)
    const { PrismaClientKnownRequestError } =
      await import('@prisma/client/runtime/library')
    vi.spyOn(campaignTasksService, 'addEventTasks').mockRejectedValue(
      new PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '6.0.0',
      }),
    )

    const message: Message = {
      MessageId: 'msg-permanent-fail',
      Body: JSON.stringify({
        type: QueueType.CAMPAIGN_PLAN_COMPLETE,
        data: {
          campaignId: 999,
          status: 'completed',
          s3Key: 'results/999/test.json',
        },
      }),
    }

    // With withLegacyErrorSwallowing: returns true (discard, don't requeue)
    // Without it: would throw and cause a requeue
    const result = await service.processMessage(message)

    expect(result).toBe(true)
  })
})

describe('QueueConsumerService - handleAgentExperimentResult', () => {
  let service: QueueConsumerService
  let module: TestingModule
  let runs: Map<
    string,
    { runId: string; status: string; experimentType?: string }
  >
  let mockExperimentRuns: {
    findUnique: ReturnType<typeof vi.fn>
    optimisticLockingUpdate: ReturnType<typeof vi.fn>
    markStarted: ReturnType<typeof vi.fn>
  }

  const seedRun = (runId: string, status: string, experimentType?: string) => {
    runs.set(runId, { runId, status, experimentType })
    return runs.get(runId)
  }

  const agentResultMessage = (data: Record<string, unknown>): Message => ({
    MessageId: `msg-${String(data.runId)}-${String(data.status)}`,
    Body: JSON.stringify({
      type: QueueType.AGENT_EXPERIMENT_RESULT,
      data,
    }),
  })

  beforeEach(async () => {
    runs = new Map()

    mockExperimentRuns = {
      findUnique: vi.fn(async ({ where }: { where: { runId: string } }) =>
        runs.get(where.runId),
      ),
      optimisticLockingUpdate: vi.fn(
        async (
          { where }: { where: { runId: string } },
          modifier: (run: {
            runId: string
            status: string
          }) => Promise<Record<string, unknown>>,
        ) => {
          const current = runs.get(where.runId)
          if (!current) throw new Error('not found')
          const patch = await modifier(current)
          const updated = { ...current, ...patch }
          runs.set(where.runId, updated as { runId: string; status: string })
          return updated
        },
      ),
      markStarted: vi.fn(async (runId: string) => {
        const current = runs.get(runId)
        if (current && current.status === 'QUEUED') {
          runs.set(runId, { ...current, status: 'RUNNING' })
        }
      }),
    }

    module = await Test.createTestingModule({
      providers: [
        QueueConsumerService,
        { provide: AiContentService, useValue: {} },
        { provide: CampaignsService, useValue: { model: {} } },
        { provide: AiGenerationService, useValue: {} },
        { provide: CampaignTasksService, useValue: {} },
        { provide: CampaignTcrComplianceService, useValue: {} },
        { provide: ContactsService, useValue: {} },
        { provide: DomainsService, useValue: {} },
        { provide: ElectedOfficeService, useValue: {} },
        { provide: OrganizationsService, useValue: {} },
        { provide: PollIndividualMessageService, useValue: { client: {} } },
        { provide: PollIssuesService, useValue: {} },
        { provide: PollsService, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: SlackService, useValue: { message: vi.fn() } },
        { provide: UsersService, useValue: {} },
        { provide: AnalyticsService, useValue: {} },
        { provide: WeeklyTasksDigestHandlerService, useValue: {} },
        { provide: Nightly10DlcReportService, useValue: {} },
        { provide: CvStatusPollService, useValue: {} },
        { provide: ExperimentRunsService, useValue: mockExperimentRuns },
        {
          provide: MeetingBriefingsService,
          useValue: {
            onExperimentRunCompleted: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CommunityIssueService,
          useValue: {
            onExperimentRunCompleted: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CampaignStrategyService,
          useValue: { onExperimentRunCompleted: vi.fn() },
        },
        {
          provide: CampaignTrackerTasksService,
          useValue: { onExperimentRunCompleted: vi.fn() },
        },
        {
          provide: RaceOpponentPersistService,
          useValue: { onExperimentRunCompleted: vi.fn() },
        },
        {
          provide: RaceOpponentResearchPersistService,
          useValue: { onExperimentRunCompleted: vi.fn() },
        },
        {
          provide: OrdinanceCodePersistService,
          useValue: { onExperimentRunCompleted: vi.fn() },
        },
        {
          provide: OrdinanceQualityLoopService,
          useValue: { handleStep: vi.fn() },
        },
        { provide: AnnotationAttachmentService, useValue: { runOcr: vi.fn() } },
        {
          provide: RecommendedListsComputeService,
          useValue: { handleRecompute: vi.fn() },
        },
        { provide: PinoLogger, useValue: createMockLogger() },
      ],
    }).compile()
    service = module.get(QueueConsumerService)
  })

  it('flips a QUEUED run to RUNNING on started', async () => {
    seedRun('run-started', 'QUEUED')

    const result = await service.processMessage(
      agentResultMessage({ runId: 'run-started', status: 'started' }),
    )

    expect(result).toBe(true)
    expect(mockExperimentRuns.markStarted).toHaveBeenCalledWith('run-started')
    expect(runs.get('run-started')?.status).toBe('RUNNING')
  })

  it('accepts a terminal result for a still-QUEUED run', async () => {
    seedRun('run-queued-fail', 'QUEUED')

    const result = await service.processMessage(
      agentResultMessage({
        runId: 'run-queued-fail',
        status: 'failed',
        error: 'boom',
      }),
    )

    expect(result).toBe(true)
    expect(runs.get('run-queued-fail')?.status).toBe('FAILED')
  })

  it('skips a terminal result for an already-terminal run', async () => {
    seedRun('run-done', 'COMPLETED')

    const result = await service.processMessage(
      agentResultMessage({
        runId: 'run-done',
        status: 'failed',
        error: 'late',
      }),
    )

    expect(result).toBe(true)
    expect(runs.get('run-done')?.status).toBe('COMPLETED')
    expect(mockExperimentRuns.optimisticLockingUpdate).not.toHaveBeenCalled()
  })

  // The silent-gap trap: without this fan-out call the run completes but its
  // artifact is never persisted, and nothing else would catch that.
  it('invokes the ordinance persist hook with the completed run', async () => {
    seedRun('run-ordinance', 'RUNNING', 'find_existing_ordinances')
    const persistSpy = vi.spyOn(
      module.get(OrdinanceCodePersistService),
      'onExperimentRunCompleted',
    )

    const result = await service.processMessage(
      agentResultMessage({ runId: 'run-ordinance', status: 'success' }),
    )

    expect(result).toBe(true)
    expect(persistSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-ordinance',
        status: 'COMPLETED',
        experimentType: 'find_existing_ordinances',
      }),
    )
  })

  it('skips a late result for a SUPERSEDED run without mutating state', async () => {
    seedRun('run-superseded', 'SUPERSEDED')

    const result = await service.processMessage(
      agentResultMessage({
        runId: 'run-superseded',
        status: 'success',
      }),
    )

    expect(result).toBe(true)
    expect(runs.get('run-superseded')?.status).toBe('SUPERSEDED')
    expect(mockExperimentRuns.optimisticLockingUpdate).not.toHaveBeenCalled()
  })
})

describe('QueueConsumerService - ORDINANCE_QUALITY_LOOP', () => {
  const buildService = (handleStep: ReturnType<typeof vi.fn>) =>
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
      { handleStep } as never,
      {} as never,
      createMockLogger(),
    )

  const loopMessage = (data: unknown): Message => ({
    MessageId: 'msg-loop-1',
    Body: JSON.stringify({ type: QueueType.ORDINANCE_QUALITY_LOOP, data }),
  })

  it('dispatches a valid quality loop step to handleStep', async () => {
    const handleStep = vi.fn().mockResolvedValue(true)
    const service = buildService(handleStep)
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
    expect(handleStep).toHaveBeenCalledWith(payload)
  })

  it('acks and drops a malformed quality loop message instead of requeueing', async () => {
    const handleStep = vi.fn()
    const service = buildService(handleStep)

    // A malformed message can never become valid; requeueing it would block
    // the ordinance's FIFO group with redeliveries until the DLQ limit.
    const result = await service.processMessage(
      loopMessage({ ordinanceId: 'o1' }),
    )

    expect(result).toBe(true)
    expect(handleStep).not.toHaveBeenCalled()
  })
})

describe('QueueConsumerService - RECOMMENDED_LISTS_RECOMPUTE', () => {
  const buildService = (handleRecompute: ReturnType<typeof vi.fn>) =>
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
      {} as never,
      { handleRecompute } as never,
      createMockLogger(),
    )

  const recomputeMessage = (data: unknown): Message => ({
    MessageId: 'msg-reclists-1',
    Body: JSON.stringify({
      type: QueueType.RECOMMENDED_LISTS_RECOMPUTE,
      data,
    }),
  })

  it('dispatches a valid recompute message to handleRecompute', async () => {
    const handleRecompute = vi.fn().mockResolvedValue(true)
    const service = buildService(handleRecompute)
    const payload = { campaignId: 42, raceId: 'race-1', attempt: 1 }

    const result = await service.processMessage(recomputeMessage(payload))

    expect(result).toBe(true)
    expect(handleRecompute).toHaveBeenCalledWith(payload)
  })

  it('acks and drops a malformed recompute message instead of requeueing', async () => {
    const handleRecompute = vi.fn()
    const service = buildService(handleRecompute)

    const result = await service.processMessage(
      recomputeMessage({ campaignId: 'not-a-number' }),
    )

    expect(result).toBe(true)
    expect(handleRecompute).not.toHaveBeenCalled()
  })
})
