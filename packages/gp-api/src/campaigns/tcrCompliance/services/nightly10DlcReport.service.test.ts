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
import { Nightly10DlcReportService } from './nightly10DlcReport.service'

type WhereClause = {
  status?: TcrComplianceStatus
  peerlyIdentityId?: null | { not: null }
  kickoffSentAt?: { lt: Date }
  peerlyBillingBlockedAt?: { gte: Date }
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
  campaign: { id: campaignId, slug, isPro: true },
  ...overrides,
})

const blocksText = (blocks: SlackMessageBlock[]): string =>
  JSON.stringify(blocks)

describe('Nightly10DlcReportService', () => {
  let service: Nightly10DlcReportService
  let mockQueue: { sendMessage: ReturnType<typeof vi.fn> }
  let mockSlack: { message: ReturnType<typeof vi.fn> }
  let mockModel: {
    findMany: ReturnType<typeof vi.fn>
    count: ReturnType<typeof vi.fn>
  }
  let mockDomain: { findMany: ReturnType<typeof vi.fn> }
  let mockExperimentRun: { findMany: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    mockQueue = { sendMessage: vi.fn().mockResolvedValue(undefined) }
    mockSlack = { message: vi.fn().mockResolvedValue('ok') }
    mockModel = {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    }
    mockDomain = { findMany: vi.fn().mockResolvedValue([]) }
    mockExperimentRun = { findMany: vi.fn().mockResolvedValue([]) }

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
        { provide: PinoLogger, useValue: createMockLogger() },
        Nightly10DlcReportService,
      ],
    }).compile()

    service = module.get(Nightly10DlcReportService)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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
          if (
            where.peerlyIdentityId &&
            typeof where.peerlyIdentityId === 'object'
          ) {
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

    it('scopes every record query to Pro campaigns', async () => {
      await service.handleNightlyReport({ reportDate: '2026-07-10' })

      for (const call of mockModel.findMany.mock.calls) {
        const [{ where }] = call as [{ where: WhereClause }]
        expect(where.campaign).toEqual({ isPro: true })
      }
      const [domainCall] = mockDomain.findMany.mock.calls[0] as [
        { where: { website: { campaign: { isPro: boolean } } } },
      ]
      expect(domainCall.where.website.campaign.isPro).toBe(true)
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
  })
})
