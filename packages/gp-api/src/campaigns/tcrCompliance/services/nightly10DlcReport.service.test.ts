import { NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { formatInTimeZone } from 'date-fns-tz'
import { subDays, subHours, subMinutes } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TcrComplianceStatus } from '../../../generated/prisma'
import { PrismaService } from '@/prisma/prisma.service'
import { QueueProducerService } from '../../../queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from '../../../queue/queue.types'
import { SlackService } from '../../../vendors/slack/services/slack.service'
import {
  SlackChannel,
  SlackMessageBlock,
} from '../../../vendors/slack/slackService.types'
import { EASTERN_TIMEZONE } from '../../../shared/util/date.util'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PeerlyCvVerificationStatus } from '../../../vendors/peerly/peerly.types'
import {
  PEERLY_PROFILE_STATUS_FINALIZED,
  PEERLY_PROFILE_STATUS_PENDING,
  PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE,
} from '../../../vendors/peerly/services/peerly.const'
import { PeerlyIdentityService } from '../../../vendors/peerly/services/peerlyIdentity.service'
import { PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES } from './campaignTcrCompliance.service'
import { Nightly10DlcReportService } from './nightly10DlcReport.service'

// The poll loop sleeps PEERLY_CV_READ_SPACING_MS between records; real
// timers would make the 121-record cap test take ~42s.
vi.mock('timers/promises', () => ({
  setTimeout: () => Promise.resolve(),
}))

type WhereClause = {
  status?: TcrComplianceStatus | { in: TcrComplianceStatus[] }
  peerlyIdentityId?: null | { not: null }
  kickoffSentAt?: { lt: Date }
  peerlyBillingBlockedAt?: { gte: Date }
  peerlyCvStatus?: string | null | { not: null; notIn: string[] }
  peerlyProfileStatus?: string | null
  peerlyProfileStatusChangedAt?: { lt: Date }
  NOT?: object
  OR?: object[]
  campaign?: { isPro: boolean }
}

const proRecord = (
  id: string,
  slug: string,
  campaignId: number,
  overrides: object = {},
) => ({
  id,
  campaignId,
  status: TcrComplianceStatus.submitted,
  peerlyIdentityId: null,
  agenticRunId: null,
  kickoffSentAt: subDays(new Date(), 3),
  createdAt: subDays(new Date(), 3),
  updatedAt: subDays(new Date(), 3),
  pinSentDetectedAt: null,
  peerlyBillingBlockedAt: null,
  peerlyCvStatus: null,
  peerlyCvStatusChangedAt: null,
  peerlyProfileStatus: null,
  peerlyProfileStatusChangedAt: null,
  peerlySubmissionStartedAt: null,
  committeeName: 'Friends of Fixture',
  email: 'candidate-email@example.com',
  phone: '555-000-1234',
  cvInReviewEscalatedAt: null,
  finalizeStalledEscalatedAt: null,
  campaign: { id: campaignId, slug, isPro: true },
  ...overrides,
})

// Queues the exact 10 sequential model.findMany results handleNightlyReport
// makes, in call order: poll candidates, stuckSubmissions, errorRecords,
// rejectedRecords, billingBlocked, agingAwaitingPin, neverReachedCv (case 1),
// profileStalled (case 3a), inReviewStalled (case 2), waitingToFinalizeStalled
// (case 3b).
const queueFindManyResults = (
  mockFindMany: ReturnType<typeof vi.fn>,
  results: [
    unknown[],
    unknown[],
    unknown[],
    unknown[],
    unknown[],
    unknown[],
    unknown[],
    unknown[],
    unknown[],
    unknown[],
  ],
) => {
  results.forEach((result) => mockFindMany.mockResolvedValueOnce(result))
}

const blocksText = (blocks: SlackMessageBlock[]): string =>
  JSON.stringify(blocks)

// Fixed Friday/Monday/Thursday instants (real 2026 calendar) so business-day
// vs calendar-day math disagree: Friday->Monday is 1 business day (weekend
// doesn't count), Friday->Thursday is 4 — a test using calendar days instead
// would wrongly escalate the Monday case (3 calendar days) and would compute
// the wrong count for Thursday (6 calendar days).
const FRIDAY_6PM_ET = new Date('2026-07-24T18:00:00-04:00')
const MONDAY_MIDNIGHT_ET = new Date('2026-07-27T00:00:00-04:00')
const THURSDAY_MIDNIGHT_ET = new Date('2026-07-30T00:00:00-04:00')

const inReviewRecord = (overrides: object = {}) =>
  proRecord('tcr-in-review', 'in-review-camp', 950, {
    peerlyIdentityId: 'ident-950',
    status: TcrComplianceStatus.submitted,
    peerlyCvStatus: PeerlyCvVerificationStatus.IN_REVIEW,
    peerlyCvStatusChangedAt: subDays(new Date(), 10),
    ...overrides,
  })

const waitingToFinalizeRecord = (overrides: object = {}) =>
  proRecord('tcr-w2f', 'w2f-camp', 960, {
    peerlyIdentityId: 'ident-960',
    status: TcrComplianceStatus.submitted,
    peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
    peerlyProfileStatus: PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE,
    peerlyProfileStatusChangedAt: subDays(new Date(), 10),
    ...overrides,
  })

const vendorCalls = (mockSlackMessage: ReturnType<typeof vi.fn>) =>
  (
    mockSlackMessage.mock.calls as [
      { blocks: SlackMessageBlock[] },
      SlackChannel,
    ][]
  ).filter(([, channel]) => channel === SlackChannel.sharedGoodpartyPeerly10Dlc)

describe('Nightly10DlcReportService', () => {
  let service: Nightly10DlcReportService
  let mockQueue: { sendMessage: ReturnType<typeof vi.fn> }
  let mockSlack: { message: ReturnType<typeof vi.fn> }
  let mockModel: {
    findMany: ReturnType<typeof vi.fn>
    count: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  let mockDomain: { findMany: ReturnType<typeof vi.fn> }
  let mockExperimentRun: { findMany: ReturnType<typeof vi.fn> }
  let mockPeerlyIdentity: {
    retrieveCampaignVerifyStatus: ReturnType<typeof vi.fn>
    getIdentityProfile: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    mockQueue = { sendMessage: vi.fn().mockResolvedValue(undefined) }
    mockSlack = { message: vi.fn().mockResolvedValue('ok') }
    mockModel = {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    }
    mockDomain = { findMany: vi.fn().mockResolvedValue([]) }
    mockExperimentRun = { findMany: vi.fn().mockResolvedValue([]) }
    // Defaults to "no CV request yet" so tests that don't care about the
    // poll (most of the pre-existing suite) never see an unexpected update.
    mockPeerlyIdentity = {
      retrieveCampaignVerifyStatus: vi.fn().mockResolvedValue(null),
      getIdentityProfile: vi.fn().mockResolvedValue(null),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PrismaService,
          useValue: {
            tcrCompliance: mockModel,
            domain: mockDomain,
            experimentRun: mockExperimentRun,
          },
        },
        { provide: QueueProducerService, useValue: mockQueue },
        { provide: SlackService, useValue: mockSlack },
        { provide: PeerlyIdentityService, useValue: mockPeerlyIdentity },
        { provide: PinoLogger, useValue: createMockLogger() },
        Nightly10DlcReportService,
      ],
    }).compile()

    service = module.get(Nightly10DlcReportService)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  describe('triggerNightlyReport', () => {
    it('does nothing outside prod so dev/qa never post', async () => {
      vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')

      await service.triggerNightlyReport()

      expect(mockQueue.sendMessage).not.toHaveBeenCalled()
    })

    it('enqueues once with a date-keyed FIFO deduplicationId in prod', async () => {
      vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
      const reportDate = formatInTimeZone(
        new Date(),
        EASTERN_TIMEZONE,
        'yyyy-MM-dd',
      )

      await service.triggerNightlyReport()

      expect(mockQueue.sendMessage).toHaveBeenCalledExactlyOnceWith(
        {
          type: QueueType.NIGHTLY_10DLC_REPORT,
          data: { reportDate },
        },
        MessageGroup.nightly10DlcReport,
        {
          deduplicationId: `nightly10DlcReport-${reportDate}`,
          throwOnError: true,
        },
      )
    })

    it('logs but does not throw when the enqueue fails', async () => {
      vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
      mockQueue.sendMessage.mockRejectedValueOnce(new Error('sqs down'))

      await expect(service.triggerNightlyReport()).resolves.toBeUndefined()
    })
  })

  describe('handleNightlyReport', () => {
    it('posts the all-clear variant with pipeline counts when nothing is stuck', async () => {
      mockModel.count
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(9)

      const result = await service.handleNightlyReport({
        reportDate: '2026-07-10',
      })

      expect(result).toBe(true)
      expect(mockSlack.message).toHaveBeenCalledTimes(1)
      const [{ blocks }, channel] = mockSlack.message.mock.calls[0] as [
        { blocks: SlackMessageBlock[] },
        SlackChannel,
      ]
      expect(channel).toBe(SlackChannel.bot10DlcCompliance)
      const text = blocksText(blocks)
      expect(text).toContain('✅ 10DLC nightly report — 2026-07-10')
      expect(text).toContain('no campaigns stuck')
      expect(text).toContain(
        '4 submitted · 2 pending carrier review · 9 approved',
      )
    })

    it('reports each stuck class in its own section with row detail', async () => {
      mockModel.findMany.mockImplementation(
        ({ where }: { where: WhereClause }) => {
          if (where.kickoffSentAt) {
            return Promise.resolve([
              proRecord('tcr-1', 'peter-erickson', 304314, {
                kickoffSentAt: subHours(new Date(), 200),
                agenticRunId: 'run-abc',
              }),
            ])
          }
          if (where.status === TcrComplianceStatus.error) {
            return Promise.resolve([proRecord('tcr-2', 'errored-camp', 222)])
          }
          if (where.status === TcrComplianceStatus.rejected) {
            return Promise.resolve([proRecord('tcr-3', 'rejected-camp', 333)])
          }
          if (where.peerlyBillingBlockedAt) {
            return Promise.resolve([
              proRecord('tcr-4', 'billing-camp', 444, {
                peerlyBillingBlockedAt: subMinutes(new Date(), 30),
              }),
            ])
          }
          // Case 1 / case 3a (ENG-10795) carry a scalar `peerlyCvStatus`
          // (null for case 1, VERIFIED for case 3a) — not exercised by this
          // test, which predates those sections. The awaiting-PIN nudge
          // instead carries `{ not: null }` and must fall through to the OR
          // branch below.
          if (
            'peerlyCvStatus' in where &&
            (where.peerlyCvStatus === null ||
              typeof where.peerlyCvStatus === 'string')
          ) {
            return Promise.resolve([])
          }
          if (
            where.peerlyIdentityId &&
            typeof where.peerlyIdentityId === 'object'
          ) {
            // The poll query (ENG-10793) shares this shape but carries no
            // OR clause — only the awaiting-PIN query does.
            if (!where.OR) {
              return Promise.resolve([])
            }
            return Promise.resolve([
              proRecord('tcr-5', 'pin-camp', 555, {
                peerlyIdentityId: '11540157',
                pinSentDetectedAt: subDays(new Date(), 10),
              }),
              proRecord('tcr-6', 'pin-undetected-camp', 556, {
                peerlyIdentityId: '11540158',
                pinSentDetectedAt: null,
                updatedAt: subDays(new Date(), 12),
              }),
            ])
          }
          return Promise.resolve([])
        },
      )
      mockDomain.findMany.mockResolvedValue([
        {
          name: 'vote-dead-domain.site',
          createdAt: subDays(new Date(), 5),
          registrantVerifiedAt: null,
          website: {
            campaignId: 666,
            campaign: { id: 666, slug: 'domain-camp', isPro: true },
          },
        },
      ])
      mockExperimentRun.findMany.mockResolvedValue([
        { runId: 'run-abc', status: 'FAILED' },
      ])

      const result = await service.handleNightlyReport({
        reportDate: '2026-07-10',
      })

      expect(result).toBe(true)
      const [{ blocks }] = mockSlack.message.mock.calls[0] as [
        { blocks: SlackMessageBlock[] },
      ]
      const text = blocksText(blocks)
      expect(text).toContain('🚨 10DLC nightly report — 2026-07-10: 5 stuck')
      expect(text).toContain('peter-erickson (campaign 304314)')
      expect(text).toContain('run-abc')
      expect(text).toContain('(FAILED)')
      expect(text).toContain('errored-camp (campaign 222)')
      expect(text).toContain('rejected-camp (campaign 333)')
      expect(text).toContain('billing-camp (campaign 444)')
      expect(text).toContain('domain-camp (campaign 666)')
      expect(text).toContain('vote-dead-domain.site')
      expect(text).toContain('pin-camp (campaign 555)')
      expect(text).toContain('Awaiting PIN')
      // The pinSentDetectedAt-null arm falls back to updatedAt for the age.
      expect(text).toContain('pin-undetected-camp (campaign 556)')
      expect(text).toContain('PIN out 12d')
      // Nudge rows are not system failures and must not inflate the count.
      expect(text).not.toContain('6 stuck')
    })

    it('scopes every record query to Pro, non-internal campaigns', async () => {
      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      // Staff test accounts use @goodparty.org (not just the seeded
      // @test.goodparty.org), so both domains must be excluded or their
      // intentionally stuck records page as real incidents.
      const expectedCampaignWhere = {
        isPro: true,
        user: {
          NOT: [
            { email: { endsWith: '@goodparty.org', mode: 'insensitive' } },
            {
              email: { endsWith: '@test.goodparty.org', mode: 'insensitive' },
            },
          ],
        },
      }
      for (const call of mockModel.findMany.mock.calls) {
        const [{ where }] = call as [{ where: WhereClause }]
        expect(where.campaign).toEqual(expectedCampaignWhere)
      }
      const [domainCall] = mockDomain.findMany.mock.calls[0] as [
        { where: { website: { campaign: object } } },
      ]
      expect(domainCall.where.website.campaign).toEqual({
        ...expectedCampaignWhere,
        tcrCompliance: {
          status: TcrComplianceStatus.submitted,
          peerlyIdentityId: null,
        },
      })
    })

    it('truncates a section to the Slack character budget and names the hidden count', async () => {
      const longSlug = (i: number) => `camp-${i}-${'x'.repeat(120)}`
      mockModel.findMany.mockImplementation(
        ({ where }: { where: WhereClause }) =>
          Promise.resolve(
            where.kickoffSentAt
              ? Array.from({ length: 40 }, (_, i) =>
                  proRecord(`tcr-${i}`, longSlug(i), i, {
                    kickoffSentAt: subHours(new Date(), 100),
                  }),
                )
              : [],
          ),
      )

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      const [{ blocks }] = mockSlack.message.mock.calls[0] as [
        { blocks: SlackMessageBlock[] },
      ]
      const text = blocksText(blocks)
      expect(text).toContain('40 stuck')
      expect(text).toMatch(/…and \d+ more/)
      expect(text).not.toContain('camp-39-')
      // Every section must stay under Slack's hard 3000-char text cap, or
      // the whole post is rejected and redelivers into the same failure.
      for (const block of blocks) {
        const sectionText =
          typeof block.text === 'object' ? block.text?.text : block.text
        if (typeof sectionText === 'string') {
          expect(sectionText.length).toBeLessThan(3000)
        }
      }
    })

    it('returns false when the Slack post fails so SQS redelivers', async () => {
      // SlackService.message swallows delivery errors and resolves undefined
      // rather than throwing — the handler must detect that, not a rejection.
      mockSlack.message.mockResolvedValueOnce(undefined)

      const result = await service.handleNightlyReport({
        reportDate: '2026-07-10',
      })

      expect(result).toBe(false)
    })

    it('polls only Pro/non-internal, identity-bearing, in-flight records', async () => {
      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      // The poll always runs first, before the section queries.
      const [pollCall] = mockModel.findMany.mock.calls[0] as [
        { where: WhereClause; orderBy: object },
      ]
      expect(pollCall.where.peerlyIdentityId).toEqual({ not: null })
      expect(pollCall.where.status).toEqual({
        in: [TcrComplianceStatus.submitted, TcrComplianceStatus.pending],
      })
      // Oldest-touched first — the per-run cap drops the tail, not the head.
      expect(pollCall.orderBy).toEqual({ updatedAt: 'asc' })
    })
  })

  describe('handleNightlyReport — Peerly status poll (ENG-10793)', () => {
    const pollRecord = (overrides: object = {}) =>
      proRecord('tcr-poll', 'poll-camp', 900, {
        peerlyIdentityId: 'ident-900',
        status: TcrComplianceStatus.submitted,
        ...overrides,
      })

    it('stamps status + changedAt on first observation (null → REQUESTED)', async () => {
      const record = pollRecord()
      mockModel.findMany.mockResolvedValueOnce([record])
      mockPeerlyIdentity.retrieveCampaignVerifyStatus.mockResolvedValueOnce(
        PeerlyCvVerificationStatus.REQUESTED,
      )

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      expect(
        mockPeerlyIdentity.retrieveCampaignVerifyStatus,
      ).toHaveBeenCalledExactlyOnceWith('ident-900', record.campaign, {
        suppressSlackAlert: true,
      })
      expect(mockModel.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'tcr-poll' },
        data: {
          peerlyCvStatus: PeerlyCvVerificationStatus.REQUESTED,
          peerlyCvStatusChangedAt: expect.any(Date),
        },
      })
    })

    it('does not rewrite changedAt on a repeat observation', async () => {
      mockModel.findMany.mockResolvedValueOnce([
        pollRecord({ peerlyCvStatus: PeerlyCvVerificationStatus.REQUESTED }),
      ])
      mockPeerlyIdentity.retrieveCampaignVerifyStatus.mockResolvedValueOnce(
        PeerlyCvVerificationStatus.REQUESTED,
      )

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      expect(mockModel.update).not.toHaveBeenCalled()
    })

    it('rewrites status + changedAt on a real transition (REQUESTED → IN_REVIEW)', async () => {
      mockModel.findMany.mockResolvedValueOnce([
        pollRecord({ peerlyCvStatus: PeerlyCvVerificationStatus.REQUESTED }),
      ])
      mockPeerlyIdentity.retrieveCampaignVerifyStatus.mockResolvedValueOnce(
        PeerlyCvVerificationStatus.IN_REVIEW,
      )

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      expect(mockModel.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'tcr-poll' },
        data: {
          peerlyCvStatus: PeerlyCvVerificationStatus.IN_REVIEW,
          peerlyCvStatusChangedAt: expect.any(Date),
        },
      })
    })

    it('does not call getProfile for a non-VERIFIED CV status', async () => {
      mockModel.findMany.mockResolvedValueOnce([pollRecord()])
      mockPeerlyIdentity.retrieveCampaignVerifyStatus.mockResolvedValueOnce(
        PeerlyCvVerificationStatus.IN_REVIEW,
      )

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      expect(mockPeerlyIdentity.getIdentityProfile).not.toHaveBeenCalled()
    })

    it('calls getProfile and stamps profile status only for VERIFIED', async () => {
      const record = pollRecord()
      mockModel.findMany.mockResolvedValueOnce([record])
      mockPeerlyIdentity.retrieveCampaignVerifyStatus.mockResolvedValueOnce(
        PeerlyCvVerificationStatus.VERIFIED,
      )
      mockPeerlyIdentity.getIdentityProfile.mockResolvedValueOnce({
        link: 'https://peerly.example/link',
        profile: { status: PEERLY_PROFILE_STATUS_PENDING },
      })

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      expect(
        mockPeerlyIdentity.getIdentityProfile,
      ).toHaveBeenCalledExactlyOnceWith('ident-900', record.campaign, {
        suppressSlackAlert: true,
      })
      expect(mockModel.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'tcr-poll' },
        data: {
          peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
          peerlyCvStatusChangedAt: expect.any(Date),
          peerlyProfileStatus: PEERLY_PROFILE_STATUS_PENDING,
          peerlyProfileStatusChangedAt: expect.any(Date),
        },
      })
    })

    it('does not erase an observed CV status when Peerly returns no CV request', async () => {
      mockModel.findMany.mockResolvedValueOnce([
        pollRecord({ peerlyCvStatus: PeerlyCvVerificationStatus.REQUESTED }),
      ])
      mockPeerlyIdentity.retrieveCampaignVerifyStatus.mockResolvedValueOnce(
        null,
      )

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      expect(mockModel.update).not.toHaveBeenCalled()
    })

    it('caps a large backlog at 120 polled records per run', async () => {
      mockModel.findMany.mockResolvedValueOnce(
        Array.from({ length: 121 }, (_, i) =>
          pollRecord({ id: `tcr-cap-${i}`, peerlyIdentityId: `ident-${i}` }),
        ),
      )
      mockPeerlyIdentity.retrieveCampaignVerifyStatus.mockResolvedValue(
        PeerlyCvVerificationStatus.REQUESTED,
      )

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      expect(
        mockPeerlyIdentity.retrieveCampaignVerifyStatus,
      ).toHaveBeenCalledTimes(120)
    })

    it('keeps a stored profile status when getProfile succeeds with an empty body', async () => {
      mockModel.findMany.mockResolvedValueOnce([
        pollRecord({
          peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
          peerlyProfileStatus: PEERLY_PROFILE_STATUS_PENDING,
        }),
      ])
      mockPeerlyIdentity.retrieveCampaignVerifyStatus.mockResolvedValueOnce(
        PeerlyCvVerificationStatus.VERIFIED,
      )
      mockPeerlyIdentity.getIdentityProfile.mockResolvedValueOnce(null)

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      expect(mockModel.update).not.toHaveBeenCalled()
    })

    it('clears a stale profile status when getProfile 404s (identity gone)', async () => {
      mockModel.findMany.mockResolvedValueOnce([
        pollRecord({
          peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
          peerlyProfileStatus: PEERLY_PROFILE_STATUS_PENDING,
        }),
      ])
      mockPeerlyIdentity.retrieveCampaignVerifyStatus.mockResolvedValueOnce(
        PeerlyCvVerificationStatus.VERIFIED,
      )
      mockPeerlyIdentity.getIdentityProfile.mockRejectedValueOnce(
        new NotFoundException(
          'Identity profile for given identity ID could not be found',
        ),
      )

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      expect(mockModel.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'tcr-poll' },
        data: {
          peerlyProfileStatus: null,
          peerlyProfileStatusChangedAt: expect.any(Date),
        },
      })
    })

    it('persists an observed CV transition even when the profile read fails', async () => {
      mockModel.findMany.mockResolvedValueOnce([
        pollRecord({ peerlyCvStatus: PeerlyCvVerificationStatus.APPROVED }),
      ])
      mockPeerlyIdentity.retrieveCampaignVerifyStatus.mockResolvedValueOnce(
        PeerlyCvVerificationStatus.VERIFIED,
      )
      mockPeerlyIdentity.getIdentityProfile.mockRejectedValueOnce(
        new Error('peerly 502'),
      )

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      expect(mockModel.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'tcr-poll' },
        data: {
          peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
          peerlyCvStatusChangedAt: expect.any(Date),
        },
      })
    })

    it("one record's Peerly error does not stop the next record's poll or overwrite its status", async () => {
      mockModel.findMany.mockResolvedValueOnce([
        pollRecord({
          id: 'tcr-fail',
          peerlyIdentityId: 'ident-fail',
          peerlyCvStatus: PeerlyCvVerificationStatus.REQUESTED,
        }),
        pollRecord({
          id: 'tcr-ok',
          campaignId: 901,
          peerlyIdentityId: 'ident-ok',
        }),
      ])
      mockPeerlyIdentity.retrieveCampaignVerifyStatus
        .mockRejectedValueOnce(new Error('peerly down'))
        .mockResolvedValueOnce(PeerlyCvVerificationStatus.APPROVED)

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      expect(mockModel.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tcr-fail' } }),
      )
      expect(mockModel.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'tcr-ok' },
        data: {
          peerlyCvStatus: PeerlyCvVerificationStatus.APPROVED,
          peerlyCvStatusChangedAt: expect.any(Date),
        },
      })
    })
  })

  describe('handleNightlyReport — CV never reached, case 1 (ENG-10795)', () => {
    it('lists a record submitted 4d ago with a live CV status still null', async () => {
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [
          proRecord('tcr-case1', 'never-reached-camp', 700, {
            peerlyIdentityId: 'ident-700',
            peerlySubmissionStartedAt: subDays(new Date(), 4),
          }),
        ],
        [],
        [],
        [],
      ])

      const result = await service.handleNightlyReport({
        reportDate: '2026-07-10',
      })

      expect(result).toBe(true)
      const [{ blocks }] = mockSlack.message.mock.calls[0] as [
        { blocks: SlackMessageBlock[] },
      ]
      const text = blocksText(blocks)
      expect(text).toContain('Never reached CampaignVerify')
      expect(text).toContain('never-reached-camp (campaign 700)')
      expect(text).toContain('identity ident-700')
      expect(text).toContain('submitted 4d ago')
      expect(text).toContain('1 stuck')
    })

    it('falls back to createdAt when peerlySubmissionStartedAt is null', async () => {
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [
          proRecord('tcr-case1b', 'fallback-camp', 701, {
            peerlyIdentityId: 'ident-701',
            peerlySubmissionStartedAt: null,
            createdAt: subDays(new Date(), 4),
          }),
        ],
        [],
        [],
        [],
      ])

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      const [{ blocks }] = mockSlack.message.mock.calls[0] as [
        { blocks: SlackMessageBlock[] },
      ]
      const text = blocksText(blocks)
      expect(text).toContain('fallback-camp (campaign 701)')
      expect(text).toContain('submitted 4d ago')
    })

    it('queries a 3-day threshold with the null-CV / submitted / has-identity filter', async () => {
      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      const case1Call = mockModel.findMany.mock.calls[6] as [
        { where: WhereClause },
      ]
      const { where } = case1Call[0]
      expect(where.status).toBe(TcrComplianceStatus.submitted)
      expect(where.peerlyIdentityId).toEqual({ not: null })
      expect(where.peerlyCvStatus).toBeNull()
      expect(where.OR).toHaveLength(2)
      const [startedAtBranch] = where.OR as [
        { peerlySubmissionStartedAt: { lt: Date } },
      ]
      const thresholdMs = subDays(new Date(), 3).getTime()
      expect(
        Math.abs(
          startedAtBranch.peerlySubmissionStartedAt.lt.getTime() - thresholdMs,
        ),
      ).toBeLessThan(5000)
    })

    it('excludes never-reached-CV and PIN-entered records from the awaiting-PIN nudge', async () => {
      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      const nudgeCall = mockModel.findMany.mock.calls[5] as [
        { where: WhereClause },
      ]
      expect(nudgeCall[0].where.peerlyCvStatus).toEqual({
        not: null,
        notIn: [PeerlyCvVerificationStatus.VERIFIED],
      })
    })
  })

  describe('handleNightlyReport — PIN verified but stalled, case 3a (ENG-10795)', () => {
    it('lists a record whose profile has sat pending since the last poll (2d ago)', async () => {
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [
          proRecord('tcr-case3a', 'stalled-camp', 800, {
            peerlyIdentityId: 'ident-800',
            peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
            peerlyProfileStatus: PEERLY_PROFILE_STATUS_PENDING,
            peerlyProfileStatusChangedAt: subDays(new Date(), 2),
          }),
        ],
        [],
        [],
      ])

      const result = await service.handleNightlyReport({
        reportDate: '2026-07-10',
      })

      expect(result).toBe(true)
      const [{ blocks }] = mockSlack.message.mock.calls[0] as [
        { blocks: SlackMessageBlock[] },
      ]
      const text = blocksText(blocks)
      expect(text).toContain('CV token/approve never completed')
      expect(text).toContain('stalled-camp (campaign 800)')
      expect(text).toContain('identity ident-800')
      expect(text).toContain('profile pending 2d')
      expect(text).toContain('1 stuck')
    })

    it('queries a 20-hour threshold with the VERIFIED / profile-pending filter', async () => {
      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      const case3aCall = mockModel.findMany.mock.calls[7] as [
        { where: WhereClause },
      ]
      const { where } = case3aCall[0]
      expect(where.status).toEqual({
        in: [TcrComplianceStatus.submitted, TcrComplianceStatus.pending],
      })
      expect(where.peerlyIdentityId).toEqual({ not: null })
      expect(where.peerlyCvStatus).toBe(PeerlyCvVerificationStatus.VERIFIED)
      // Excludes only records inside the active billing-block window; a
      // stale block (past cooldown) must not hide a profile stall.
      const notClause = where.NOT as {
        peerlyBillingBlockedAt: { gte: Date }
      }
      const blockWindowMs = subMinutes(
        new Date(),
        PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES,
      ).getTime()
      expect(
        Math.abs(
          notClause.peerlyBillingBlockedAt.gte.getTime() - blockWindowMs,
        ),
      ).toBeLessThan(5000)
      const thresholdMs = subHours(new Date(), 20).getTime()
      expect(where.peerlyProfileStatusChangedAt).toBeDefined()
      expect(
        Math.abs(
          (where.peerlyProfileStatusChangedAt as { lt: Date }).lt.getTime() -
            thresholdMs,
        ),
      ).toBeLessThan(5000)
    })
  })

  describe('handleNightlyReport — stuck count aggregation', () => {
    it('counts both new sections toward the header stuck count', async () => {
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [
          proRecord('tcr-case1', 'never-reached-camp', 700, {
            peerlyIdentityId: 'ident-700',
            peerlySubmissionStartedAt: subDays(new Date(), 4),
          }),
        ],
        [
          proRecord('tcr-case3a', 'stalled-camp', 800, {
            peerlyIdentityId: 'ident-800',
            peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
            peerlyProfileStatus: PEERLY_PROFILE_STATUS_PENDING,
            peerlyProfileStatusChangedAt: subDays(new Date(), 2),
          }),
        ],
        [],
        [],
      ])

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      const [{ blocks }] = mockSlack.message.mock.calls[0] as [
        { blocks: SlackMessageBlock[] },
      ]
      const text = blocksText(blocks)
      expect(text).toContain('2 stuck')
    })
  })

  describe('handleNightlyReport — vendor escalation, CV IN_REVIEW (case 2, ENG-10796)', () => {
    it('does not escalate 1 business day after entering IN_REVIEW (Friday -> Monday)', async () => {
      vi.useFakeTimers({ now: MONDAY_MIDNIGHT_ET })
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [inReviewRecord({ peerlyCvStatusChangedAt: FRIDAY_6PM_ET })],
        [],
      ])

      await service.handleNightlyReport({ reportDate: '2026-07-27' })

      expect(vendorCalls(mockSlack.message)).toHaveLength(0)
      expect(mockModel.updateMany).not.toHaveBeenCalled()
    })

    it('escalates once 4 business days after entering IN_REVIEW (Friday -> Thursday)', async () => {
      vi.useFakeTimers({ now: THURSDAY_MIDNIGHT_ET })
      const record = inReviewRecord({ peerlyCvStatusChangedAt: FRIDAY_6PM_ET })
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [record],
        [],
      ])

      const result = await service.handleNightlyReport({
        reportDate: '2026-07-30',
      })

      expect(result).toBe(true)
      expect(vendorCalls(mockSlack.message)).toHaveLength(1)
      const [{ blocks }, channel] = vendorCalls(mockSlack.message)[0] as [
        { blocks: SlackMessageBlock[] },
        SlackChannel,
      ]
      expect(channel).toBe(SlackChannel.sharedGoodpartyPeerly10Dlc)
      const text = blocksText(blocks)
      expect(text).toContain('4 business days')
      expect(mockModel.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: { id: record.id, cvInReviewEscalatedAt: null },
        data: { cvInReviewEscalatedAt: expect.any(Date) },
      })
    })

    it('does not re-post across two consecutive handler runs (once-only)', async () => {
      const record = inReviewRecord({
        peerlyCvStatusChangedAt: subDays(new Date(), 10),
      })
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [record],
        [],
      ])
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [record],
        [],
      ])
      // First run's claim succeeds; the second run's claim finds the row
      // already claimed (updateMany's WHERE no longer matches) — mirrors the
      // real DB behavior without needing to thread state through the mock.
      mockModel.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 })

      await service.handleNightlyReport({ reportDate: '2026-07-10' })
      await service.handleNightlyReport({ reportDate: '2026-07-11' })

      expect(vendorCalls(mockSlack.message)).toHaveLength(1)
    })

    it('rolls back the claim when the Slack post fails, so the next run retries', async () => {
      const record = inReviewRecord({
        peerlyCvStatusChangedAt: subDays(new Date(), 10),
      })
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [record],
        [],
      ])
      mockSlack.message
        .mockResolvedValueOnce('ok') // internal report post succeeds
        .mockResolvedValueOnce(undefined) // vendor post fails

      const result = await service.handleNightlyReport({
        reportDate: '2026-07-10',
      })

      expect(result).toBe(true)
      expect(mockModel.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: record.id, cvInReviewEscalatedAt: null },
        data: { cvInReviewEscalatedAt: expect.any(Date) },
      })
      expect(mockModel.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: record.id, cvInReviewEscalatedAt: expect.any(Date) },
        data: { cvInReviewEscalatedAt: null },
      })
    })

    it('clears cvInReviewEscalatedAt when the poll observes IN_REVIEW -> APPROVED', async () => {
      mockModel.findMany.mockResolvedValueOnce([
        inReviewRecord({ cvInReviewEscalatedAt: subDays(new Date(), 1) }),
      ])
      mockPeerlyIdentity.retrieveCampaignVerifyStatus.mockResolvedValueOnce(
        PeerlyCvVerificationStatus.APPROVED,
      )

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      expect(mockModel.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'tcr-in-review' },
        data: {
          peerlyCvStatus: PeerlyCvVerificationStatus.APPROVED,
          peerlyCvStatusChangedAt: expect.any(Date),
          cvInReviewEscalatedAt: null,
        },
      })
    })

    it('names the identity + committee and omits candidate email/phone', async () => {
      const record = inReviewRecord({
        peerlyCvStatusChangedAt: subDays(new Date(), 10),
        committeeName: 'Friends of Escalation',
        email: 'candidate@example.com',
        phone: '555-867-5309',
      })
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [record],
        [],
      ])

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      const [{ blocks }] = vendorCalls(mockSlack.message)[0] as [
        { blocks: SlackMessageBlock[] },
        SlackChannel,
      ]
      const text = blocksText(blocks)
      expect(text).toContain('ident-950')
      expect(text).toContain('Friends of Escalation')
      expect(text).not.toContain('candidate@example.com')
      expect(text).not.toContain('555-867-5309')
    })
  })

  describe('handleNightlyReport — vendor escalation, waiting_to_finalize (case 3b, ENG-10796)', () => {
    it('does not escalate at 2 business days (no weekend crossed)', async () => {
      const mondaySixPm = new Date('2026-07-20T18:00:00-04:00')
      const wednesdayMidnight = new Date('2026-07-22T00:00:00-04:00')
      vi.useFakeTimers({ now: wednesdayMidnight })
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [
          waitingToFinalizeRecord({
            peerlyProfileStatusChangedAt: mondaySixPm,
          }),
        ],
      ])

      await service.handleNightlyReport({ reportDate: '2026-07-22' })

      expect(vendorCalls(mockSlack.message)).toHaveLength(0)
    })

    it('escalates once 4 business days after entering waiting_to_finalize (Friday -> Thursday)', async () => {
      vi.useFakeTimers({ now: THURSDAY_MIDNIGHT_ET })
      const record = waitingToFinalizeRecord({
        peerlyProfileStatusChangedAt: FRIDAY_6PM_ET,
      })
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [record],
      ])

      const result = await service.handleNightlyReport({
        reportDate: '2026-07-30',
      })

      expect(result).toBe(true)
      expect(vendorCalls(mockSlack.message)).toHaveLength(1)
      const [{ blocks }] = vendorCalls(mockSlack.message)[0] as [
        { blocks: SlackMessageBlock[] },
        SlackChannel,
      ]
      const text = blocksText(blocks)
      expect(text).toContain('4 business days')
      expect(mockModel.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: { id: record.id, finalizeStalledEscalatedAt: null },
        data: { finalizeStalledEscalatedAt: expect.any(Date) },
      })
    })

    it('clears finalizeStalledEscalatedAt when the poll observes profile leaving waiting_to_finalize', async () => {
      mockModel.findMany.mockResolvedValueOnce([
        waitingToFinalizeRecord({
          finalizeStalledEscalatedAt: subDays(new Date(), 1),
        }),
      ])
      mockPeerlyIdentity.retrieveCampaignVerifyStatus.mockResolvedValueOnce(
        PeerlyCvVerificationStatus.VERIFIED,
      )
      mockPeerlyIdentity.getIdentityProfile.mockResolvedValueOnce({
        link: 'https://peerly.example/link',
        profile: { status: PEERLY_PROFILE_STATUS_FINALIZED },
      })

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      expect(mockModel.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'tcr-w2f' },
        data: {
          peerlyProfileStatus: PEERLY_PROFILE_STATUS_FINALIZED,
          peerlyProfileStatusChangedAt: expect.any(Date),
          finalizeStalledEscalatedAt: null,
        },
      })
    })
  })

  describe('handleNightlyReport — vendor escalation internal mirror sections (ENG-10796)', () => {
    it('lists escalated records tagged with (escalated <date>) and counts them toward stuck', async () => {
      const escalatedAt = subDays(new Date(), 1)
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [
          inReviewRecord({
            peerlyCvStatusChangedAt: subDays(new Date(), 10),
            cvInReviewEscalatedAt: escalatedAt,
          }),
        ],
        [
          waitingToFinalizeRecord({
            peerlyProfileStatusChangedAt: subDays(new Date(), 10),
            finalizeStalledEscalatedAt: escalatedAt,
          }),
        ],
      ])

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      const [{ blocks }] = mockSlack.message.mock.calls[0] as [
        { blocks: SlackMessageBlock[] },
      ]
      const text = blocksText(blocks)
      expect(text).toContain('CV IN_REVIEW >3 business days')
      expect(text).toContain('waiting_to_finalize >3 business days')
      expect(text).toContain('in-review-camp (campaign 950)')
      expect(text).toContain('w2f-camp (campaign 960)')
      expect(text).toContain('2 stuck')
    })

    it('shows "escalation pending" when the claim is still null', async () => {
      queueFindManyResults(mockModel.findMany, [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [inReviewRecord({ peerlyCvStatusChangedAt: subDays(new Date(), 10) })],
        [],
      ])

      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      const [{ blocks }] = mockSlack.message.mock.calls[0] as [
        { blocks: SlackMessageBlock[] },
      ]
      const text = blocksText(blocks)
      expect(text).toContain('escalation pending')
    })
  })
})
