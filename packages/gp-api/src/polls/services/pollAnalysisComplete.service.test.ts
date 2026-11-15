import { readFileSync } from 'fs'
import { join } from 'path'
import { InternalServerErrorException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsService } from '@/analytics/analytics.service'
import type {
  PollAnalysisCompleteEvent,
  PollResponseJsonRow,
} from '@/queue/queue.types'
import { firstOrThrow } from '@/shared/test-utils/arrays.util'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { EVENTS } from '@/vendors/segment/segment.types'
import { PollAnalysisCompleteService } from './pollAnalysisComplete.service'
import { PollsService } from './polls.service'

const createPollAnalysisCompleteData = (data: {
  pollId: string
  totalResponses?: number
  responsesLocation?: string
  promptSource?: 'hosted' | 'fallback'
  issues?: Array<{
    pollId: string
    rank: number
    theme: string
    summary: string
    analysis: string
    responseCount: number
    quotes: Array<{ quote: string; phone_number: string }>
  }>
}): PollAnalysisCompleteEvent['data'] => ({
  pollId: data.pollId,
  totalResponses: data.totalResponses ?? 10,
  responsesLocation:
    data.responsesLocation ?? 'polls/poll-1/all_cluster_analysis.json',
  ...(data.promptSource ? { promptSource: data.promptSource } : {}),
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

describe('PollAnalysisCompleteService - handlePollAnalysisComplete', () => {
  let service: PollAnalysisCompleteService
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
  let contactsService: {
    findContacts: ReturnType<typeof vi.fn>
    findPersonByPhone: ReturnType<typeof vi.fn>
    resolveProAccess: ReturnType<typeof vi.fn>
    resolvePeopleDataset: ReturnType<typeof vi.fn>
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
  let usersService: { findUnique: ReturnType<typeof vi.fn> }
  let hubspotSingleSend: { sendSingleSend: ReturnType<typeof vi.fn> }
  let logger: ReturnType<typeof createMockLogger>

  const pollId = 'poll-123'
  const electedOfficeId = 'office-1'
  const officeUserId = 1
  const officeUserEmail = 'official@example.com'
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
    contactsService = {
      findContacts: vi
        .fn()
        .mockResolvedValue({ pagination: { totalResults: 100 } }),
      findPersonByPhone: vi.fn().mockResolvedValue(null),
      resolveProAccess: vi.fn().mockResolvedValue(true),
      resolvePeopleDataset: vi.fn().mockResolvedValue({ base: 'constituents' }),
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
    usersService = {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: officeUserId, email: officeUserEmail }),
    }
    hubspotSingleSend = {
      sendSingleSend: vi.fn().mockResolvedValue(undefined),
    }
    logger = createMockLogger()

    service = new PollAnalysisCompleteService(
      analytics as unknown as AnalyticsService,
      pollsService as unknown as PollsService,
      pollIssuesService as never,
      pollIndividualMessage as never,
      electedOfficeService as never,
      contactsService as never,
      s3Service as never,
      usersService as never,
      {} as never,
      hubspotSingleSend as never,
      logger,
    )
  })

  it('acks and does not create messages when poll is not found', async () => {
    pollsService.findUnique.mockResolvedValue(null)
    const data = createPollAnalysisCompleteData({ pollId })

    await service.handlePollAnalysisComplete(data)
    expect(s3Service.getFile).not.toHaveBeenCalled()
    expect(pollIssuesService.model.deleteMany).not.toHaveBeenCalled()
  })

  it('warns when the cluster-analysis prompt fell back to the in-repo prompt', async () => {
    pollsService.findUnique.mockResolvedValue(null)
    const data = createPollAnalysisCompleteData({
      pollId,
      promptSource: 'fallback',
    })

    await service.handlePollAnalysisComplete(data)

    expect(logger.warn).toHaveBeenCalledWith(
      { pollId },
      'Synthesis run used the in-repo theme prompt',
    )
  })

  it('does not warn when the prompt came from the hosted build', async () => {
    pollsService.findUnique.mockResolvedValue(null)
    const data = createPollAnalysisCompleteData({
      pollId,
      promptSource: 'hosted',
    })

    await service.handlePollAnalysisComplete(data)

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('does not warn when the pipeline sent no promptSource at all', async () => {
    pollsService.findUnique.mockResolvedValue(null)
    const data = createPollAnalysisCompleteData({ pollId })

    await service.handlePollAnalysisComplete(data)

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('acks and does not create messages when poll is not SCHEDULED or IN_PROGRESS', async () => {
    pollsService.findUnique.mockResolvedValue({
      id: pollId,
      electedOfficeId,
      isCompleted: true,
      scheduledDate: new Date('2020-01-01'),
    })
    const data = createPollAnalysisCompleteData({ pollId })

    await service.handlePollAnalysisComplete(data)
    expect(s3Service.getFile).not.toHaveBeenCalled()
  })

  it('throws when S3 getFile returns null', async () => {
    s3Service.getFile.mockResolvedValue(null)
    const data = createPollAnalysisCompleteData({ pollId })

    await expect(service.handlePollAnalysisComplete(data)).rejects.toThrow(
      InternalServerErrorException,
    )
    await expect(service.handlePollAnalysisComplete(data)).rejects.toThrow(
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
    const data = createPollAnalysisCompleteData({ pollId })

    await service.handlePollAnalysisComplete(data)
    expect(contactsService.findPersonByPhone).toHaveBeenCalledWith(
      '5559999999',
      expect.anything(),
      expect.anything(),
      { base: 'constituents' },
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
    const data = createPollAnalysisCompleteData({ pollId })

    await service.handlePollAnalysisComplete(data)
    expect(contactsService.findPersonByPhone).toHaveBeenCalledWith(
      '5559999999',
      expect.anything(),
      expect.anything(),
      { base: 'constituents' },
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
    const data = createPollAnalysisCompleteData({ pollId })

    await service.handlePollAnalysisComplete(data)
    // Pro-access resolved once, not once per phone.
    expect(contactsService.resolveProAccess).toHaveBeenCalledTimes(1)
    // The people table is resolved once for the whole fan-out, not per phone.
    expect(contactsService.resolvePeopleDataset).toHaveBeenCalledTimes(1)
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
    const data = createPollAnalysisCompleteData({ pollId })

    await service.handlePollAnalysisComplete(data)

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
    const data = createPollAnalysisCompleteData({ pollId })

    await service.handlePollAnalysisComplete(data)
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
    const data = createPollAnalysisCompleteData({
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

    await service.handlePollAnalysisComplete(data)
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
    const data = createPollAnalysisCompleteData({ pollId })

    await service.handlePollAnalysisComplete(data)

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
    const data = createPollAnalysisCompleteData({
      pollId,
      totalResponses: 50,
      issues,
    })

    await service.handlePollAnalysisComplete(data)

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
    const data = createPollAnalysisCompleteData({
      pollId,
      totalResponses: 0,
      issues: [],
    })

    await service.handlePollAnalysisComplete(data)

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

    const data = createPollAnalysisCompleteData({
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

    await service.handlePollAnalysisComplete(data)
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
    const data = createPollAnalysisCompleteData({ pollId })

    await service.handlePollAnalysisComplete(data)
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
    const data = createPollAnalysisCompleteData({ pollId })

    await service.handlePollAnalysisComplete(data)

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
    const data = createPollAnalysisCompleteData({
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

    await service.handlePollAnalysisComplete(data)

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
    const data = createPollAnalysisCompleteData({ pollId })

    await service.handlePollAnalysisComplete(data)
    await service.handlePollAnalysisComplete(data)

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

  describe('HubSpot single-send (ENG-11035)', () => {
    beforeEach(() => {
      const json = createPollAnalysisJson([
        {
          phoneNumber,
          receivedAt: '2024-01-15T10:00:00Z',
          originalMessage: 'A response',
          clusterId: 1,
        },
      ])
      s3Service.getFile.mockResolvedValue(json)
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('does not call HubSpot single-send when HUBSPOT_POLL_RESULTS_EMAIL_ID is unset', async () => {
      const data = createPollAnalysisCompleteData({ pollId })

      await service.handlePollAnalysisComplete(data)

      expect(usersService.findUnique).not.toHaveBeenCalled()
      expect(hubspotSingleSend.sendSingleSend).not.toHaveBeenCalled()
    })

    it('sends to the office account email with the poll content once configured', async () => {
      vi.stubEnv('HUBSPOT_POLL_RESULTS_EMAIL_ID', '555111')
      const data = createPollAnalysisCompleteData({ pollId })

      await service.handlePollAnalysisComplete(data)

      expect(usersService.findUnique).toHaveBeenCalledWith({
        where: { id: officeUserId },
      })
      expect(hubspotSingleSend.sendSingleSend).toHaveBeenCalledWith({
        emailId: 555111,
        to: officeUserEmail,
        customProperties: {
          poll_id: pollId,
          path: `/dashboard/polls/${pollId}`,
        },
      })
      // The Segment event keeps firing unchanged alongside the single-send.
      expect(analytics.track).toHaveBeenCalledWith(
        officeUserId,
        EVENTS.Polls.ResultsSynthesisCompleted,
        expect.objectContaining({ pollId }),
      )
    })

    it('logs and does not requeue the message when the single-send fails', async () => {
      vi.stubEnv('HUBSPOT_POLL_RESULTS_EMAIL_ID', '555111')
      hubspotSingleSend.sendSingleSend.mockRejectedValueOnce(
        new Error('HubSpot down'),
      )
      const data = createPollAnalysisCompleteData({ pollId })

      await service.handlePollAnalysisComplete(data)
    })

    it('skips the single-send when the office user cannot be found', async () => {
      vi.stubEnv('HUBSPOT_POLL_RESULTS_EMAIL_ID', '555111')
      usersService.findUnique.mockResolvedValueOnce(null)
      const data = createPollAnalysisCompleteData({ pollId })

      await service.handlePollAnalysisComplete(data)
      expect(hubspotSingleSend.sendSingleSend).not.toHaveBeenCalled()
    })
  })
})
