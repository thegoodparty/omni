import { NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { formatInTimeZone } from 'date-fns-tz'
import { subDays } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TcrComplianceStatus } from '../../../generated/prisma'
import { PrismaService } from '@/prisma/prisma.service'
import { QueueProducerService } from '../../../queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from '../../../queue/queue.types'
import { EASTERN_TIMEZONE } from '../../../shared/util/date.util'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PeerlyCvVerificationStatus } from '../../../vendors/peerly/peerly.types'
import {
  PEERLY_PROFILE_STATUS_FINALIZED,
  PEERLY_PROFILE_STATUS_PENDING,
  PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE,
} from '../../../vendors/peerly/services/peerly.const'
import { PeerlyIdentityService } from '../../../vendors/peerly/services/peerlyIdentity.service'
import { CampaignTcrComplianceService } from './campaignTcrCompliance.service'
import { CvStatusPollService } from './cvStatusPoll.service'

// The scan sleeps RETRIEVE_CV_SPACING_MS (1 minute in prod) between records;
// real timers would hang every multi-record test.
vi.mock('timers/promises', () => ({
  setTimeout: () => Promise.resolve(),
}))

const scanRecord = (
  id: string,
  campaignId: number,
  overrides: object = {},
) => ({
  id,
  campaignId,
  status: TcrComplianceStatus.submitted,
  peerlyIdentityId: `ident-${campaignId}`,
  pinDeliveryMethod: null,
  pinSentDetectedAt: null,
  peerlyCvStatus: null,
  peerlyCvStatusChangedAt: null,
  peerlyProfileStatus: null,
  peerlyProfileStatusChangedAt: null,
  cvInReviewEscalatedAt: null,
  finalizeStalledEscalatedAt: null,
  updatedAt: subDays(new Date(), 1),
  campaign: {
    id: campaignId,
    isPro: true,
    user: { id: campaignId + 5000 },
    data: {},
  },
  ...overrides,
})

describe('CvStatusPollService', () => {
  let service: CvStatusPollService
  let mockQueue: { sendMessage: ReturnType<typeof vi.fn> }
  let mockModel: {
    findMany: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  let mockPeerly: {
    retrieveCampaignVerifyDetails: ReturnType<typeof vi.fn>
    getIdentityProfile: ReturnType<typeof vi.fn>
  }
  let mockTcr: { applyCvDetection: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    mockQueue = { sendMessage: vi.fn().mockResolvedValue(undefined) }
    mockModel = {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    }
    mockPeerly = {
      retrieveCampaignVerifyDetails: vi
        .fn()
        .mockResolvedValue({ status: null, pinDelivery: null }),
      getIdentityProfile: vi.fn().mockResolvedValue(null),
    }
    mockTcr = { applyCvDetection: vi.fn().mockResolvedValue(undefined) }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: { tcrCompliance: mockModel } },
        { provide: QueueProducerService, useValue: mockQueue },
        { provide: PeerlyIdentityService, useValue: mockPeerly },
        { provide: CampaignTcrComplianceService, useValue: mockTcr },
        { provide: PinoLogger, useValue: createMockLogger() },
        CvStatusPollService,
      ],
    }).compile()

    service = module.get(CvStatusPollService)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('triggerScan', () => {
    it('does nothing outside prod so dev/qa never call Peerly', async () => {
      vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')

      await service.triggerScan()

      expect(mockQueue.sendMessage).not.toHaveBeenCalled()
    })

    it('enqueues once with a slot-keyed FIFO deduplicationId in prod', async () => {
      vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
      const scanKey = formatInTimeZone(
        new Date(),
        EASTERN_TIMEZONE,
        'yyyy-MM-dd-HH',
      )

      await service.triggerScan()

      expect(mockQueue.sendMessage).toHaveBeenCalledExactlyOnceWith(
        {
          type: QueueType.CV_STATUS_POLL,
          data: { scanKey },
        },
        MessageGroup.cvStatusPoll,
        {
          deduplicationId: `cvStatusPoll-${scanKey}`,
          throwOnError: true,
        },
      )
    })

    it('logs but does not throw when the enqueue fails', async () => {
      vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
      mockQueue.sendMessage.mockRejectedValueOnce(new Error('sqs down'))

      await expect(service.triggerScan()).resolves.toBeUndefined()
    })
  })

  describe('handleCvStatusPoll', () => {
    it('acks immediately and runs the scan detached', () => {
      const runScan = vi.spyOn(service, 'runScan').mockResolvedValue(undefined)

      const result = service.handleCvStatusPoll({ scanKey: '2026-08-17-08' })

      expect(result).toBe(true)
      expect(runScan).toHaveBeenCalledWith('2026-08-17-08')
    })

    it('still acks when the detached scan rejects', async () => {
      vi.spyOn(service, 'runScan').mockRejectedValue(new Error('scan died'))

      const result = service.handleCvStatusPoll({ scanKey: '2026-08-17-08' })

      expect(result).toBe(true)
      // Flush the detached rejection so it cannot surface as unhandled.
      await new Promise((resolve) => setImmediate(resolve))
    })
  })

  describe('runScan — CV pass', () => {
    it('polls only pre-VERIFIED, non-terminal, Pro, identity-bearing records', async () => {
      await service.runScan('slot')

      const [cvCall] = mockModel.findMany.mock.calls[0] as [
        {
          where: {
            peerlyIdentityId: object
            status: object
            OR: object[]
            campaign: { isPro: boolean }
          }
          orderBy: object
        },
      ]
      expect(cvCall.where.peerlyIdentityId).toEqual({ not: null })
      expect(cvCall.where.status).toEqual({
        in: [TcrComplianceStatus.submitted, TcrComplianceStatus.pending],
      })
      expect(cvCall.where.OR).toEqual([
        { peerlyCvStatus: null },
        {
          peerlyCvStatus: {
            in: [
              PeerlyCvVerificationStatus.REQUESTED,
              PeerlyCvVerificationStatus.IN_REVIEW,
              PeerlyCvVerificationStatus.APPROVED,
            ],
          },
        },
      ])
      expect(cvCall.where.campaign.isPro).toBe(true)
      // Oldest-touched first — the per-scan cap drops the tail, not the head.
      expect(cvCall.orderBy).toEqual({ updatedAt: 'asc' })
    })

    it('reads retrieve_cv once per record with Slack alerts suppressed', async () => {
      const a = scanRecord('tcr-a', 1)
      const b = scanRecord('tcr-b', 2)
      mockModel.findMany.mockResolvedValueOnce([a, b])

      await service.runScan('slot')

      expect(mockPeerly.retrieveCampaignVerifyDetails).toHaveBeenCalledTimes(2)
      expect(mockPeerly.retrieveCampaignVerifyDetails).toHaveBeenCalledWith(
        'ident-1',
        a.campaign,
        { suppressSlackAlert: true },
      )
    })

    it('feeds the observation into applyCvDetection', async () => {
      const record = scanRecord('tcr-a', 1)
      mockModel.findMany.mockResolvedValueOnce([record])
      const details = {
        status: PeerlyCvVerificationStatus.APPROVED,
        pinDelivery: { method: 'text', destination: '3125550000' },
      }
      mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce(details)

      await service.runScan('slot')

      expect(mockTcr.applyCvDetection).toHaveBeenCalledExactlyOnceWith(
        record,
        record.campaign,
        details,
      )
    })

    it('stamps status + changedAt on first observation (null → REQUESTED)', async () => {
      const record = scanRecord('tcr-a', 1)
      mockModel.findMany.mockResolvedValueOnce([record])
      mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce({
        status: PeerlyCvVerificationStatus.REQUESTED,
        pinDelivery: null,
      })

      await service.runScan('slot')

      expect(mockModel.update).toHaveBeenCalledWith({
        where: { id: 'tcr-a' },
        data: {
          peerlyCvStatus: PeerlyCvVerificationStatus.REQUESTED,
          peerlyCvStatusChangedAt: expect.any(Date),
        },
      })
    })

    it('does not touch the row on a repeat observation', async () => {
      const record = scanRecord('tcr-a', 1, {
        peerlyCvStatus: PeerlyCvVerificationStatus.REQUESTED,
      })
      mockModel.findMany.mockResolvedValueOnce([record])
      mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce({
        status: PeerlyCvVerificationStatus.REQUESTED,
        pinDelivery: null,
      })

      await service.runScan('slot')

      expect(mockModel.update).not.toHaveBeenCalled()
    })

    it('does not erase an observed CV status when Peerly returns no CV request', async () => {
      const record = scanRecord('tcr-a', 1, {
        peerlyCvStatus: PeerlyCvVerificationStatus.REQUESTED,
      })
      mockModel.findMany.mockResolvedValueOnce([record])
      mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce({
        status: null,
        pinDelivery: null,
      })

      await service.runScan('slot')

      expect(mockModel.update).not.toHaveBeenCalled()
    })

    it('clears cvInReviewEscalatedAt when the record leaves IN_REVIEW', async () => {
      const record = scanRecord('tcr-a', 1, {
        peerlyCvStatus: PeerlyCvVerificationStatus.IN_REVIEW,
        cvInReviewEscalatedAt: subDays(new Date(), 2),
      })
      mockModel.findMany.mockResolvedValueOnce([record])
      mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce({
        status: PeerlyCvVerificationStatus.APPROVED,
        pinDelivery: null,
      })

      await service.runScan('slot')

      expect(mockModel.update).toHaveBeenCalledWith({
        where: { id: 'tcr-a' },
        data: {
          peerlyCvStatus: PeerlyCvVerificationStatus.APPROVED,
          peerlyCvStatusChangedAt: expect.any(Date),
          cvInReviewEscalatedAt: null,
        },
      })
    })

    it('reads the profile in the same pass when the CV reaches VERIFIED', async () => {
      const record = scanRecord('tcr-a', 1, {
        peerlyCvStatus: PeerlyCvVerificationStatus.APPROVED,
      })
      mockModel.findMany.mockResolvedValueOnce([record])
      mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce({
        status: PeerlyCvVerificationStatus.VERIFIED,
        pinDelivery: null,
      })
      mockPeerly.getIdentityProfile.mockResolvedValueOnce({
        profile: { status: PEERLY_PROFILE_STATUS_PENDING },
      })

      await service.runScan('slot')

      expect(mockPeerly.getIdentityProfile).toHaveBeenCalledWith(
        'ident-1',
        record.campaign,
        { suppressSlackAlert: true },
      )
      expect(mockModel.update).toHaveBeenCalledWith({
        where: { id: 'tcr-a' },
        data: {
          peerlyProfileStatus: PEERLY_PROFILE_STATUS_PENDING,
          peerlyProfileStatusChangedAt: expect.any(Date),
        },
      })
    })

    it('does not read the profile for a non-VERIFIED CV status', async () => {
      const record = scanRecord('tcr-a', 1)
      mockModel.findMany.mockResolvedValueOnce([record])
      mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce({
        status: PeerlyCvVerificationStatus.IN_REVIEW,
        pinDelivery: null,
      })

      await service.runScan('slot')

      expect(mockPeerly.getIdentityProfile).not.toHaveBeenCalled()
    })

    it("one record's Peerly error does not stop the next record's poll", async () => {
      const a = scanRecord('tcr-a', 1)
      const b = scanRecord('tcr-b', 2)
      mockModel.findMany.mockResolvedValueOnce([a, b])
      mockPeerly.retrieveCampaignVerifyDetails
        .mockRejectedValueOnce(new Error('peerly down'))
        .mockResolvedValueOnce({
          status: PeerlyCvVerificationStatus.REQUESTED,
          pinDelivery: null,
        })

      await service.runScan('slot')

      expect(mockModel.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'tcr-b' },
        data: {
          peerlyCvStatus: PeerlyCvVerificationStatus.REQUESTED,
          peerlyCvStatusChangedAt: expect.any(Date),
        },
      })
    })

    it('skips the status persist when detection fails so the record retries next scan', async () => {
      const record = scanRecord('tcr-a', 1)
      mockModel.findMany.mockResolvedValueOnce([record])
      mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce({
        status: PeerlyCvVerificationStatus.REQUESTED,
        pinDelivery: null,
      })
      mockTcr.applyCvDetection.mockRejectedValueOnce(new Error('segment down'))

      await service.runScan('slot')

      expect(mockModel.update).not.toHaveBeenCalled()
    })

    it('caps a runaway backlog at 300 polled records per scan', async () => {
      const records = Array.from({ length: 301 }, (_, i) =>
        scanRecord(`tcr-${i}`, i),
      )
      mockModel.findMany.mockResolvedValueOnce(records)

      await service.runScan('slot')

      expect(mockPeerly.retrieveCampaignVerifyDetails).toHaveBeenCalledTimes(
        300,
      )
    })
  })

  describe('runScan — profile pass', () => {
    it('reads only VERIFIED in-flight records, with no retrieve_cv call', async () => {
      const record = scanRecord('tcr-v', 9, {
        peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
        peerlyProfileStatus: PEERLY_PROFILE_STATUS_PENDING,
      })
      mockModel.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([record])
      mockPeerly.getIdentityProfile.mockResolvedValueOnce({
        profile: { status: PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE },
      })

      await service.runScan('slot')

      const [profileCall] = mockModel.findMany.mock.calls[1] as [
        { where: { peerlyCvStatus: string } },
      ]
      expect(profileCall.where.peerlyCvStatus).toBe(
        PeerlyCvVerificationStatus.VERIFIED,
      )
      expect(mockPeerly.retrieveCampaignVerifyDetails).not.toHaveBeenCalled()
      expect(mockModel.update).toHaveBeenCalledWith({
        where: { id: 'tcr-v' },
        data: {
          peerlyProfileStatus: PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE,
          peerlyProfileStatusChangedAt: expect.any(Date),
        },
      })
    })

    it('clears finalizeStalledEscalatedAt when the profile leaves waiting_to_finalize', async () => {
      const record = scanRecord('tcr-v', 9, {
        peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
        peerlyProfileStatus: PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE,
        finalizeStalledEscalatedAt: subDays(new Date(), 2),
      })
      mockModel.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([record])
      mockPeerly.getIdentityProfile.mockResolvedValueOnce({
        profile: { status: PEERLY_PROFILE_STATUS_FINALIZED },
      })

      await service.runScan('slot')

      expect(mockModel.update).toHaveBeenCalledWith({
        where: { id: 'tcr-v' },
        data: {
          peerlyProfileStatus: PEERLY_PROFILE_STATUS_FINALIZED,
          peerlyProfileStatusChangedAt: expect.any(Date),
          finalizeStalledEscalatedAt: null,
        },
      })
    })

    it('keeps a stored profile status when getProfile succeeds with an empty body', async () => {
      const record = scanRecord('tcr-v', 9, {
        peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
        peerlyProfileStatus: PEERLY_PROFILE_STATUS_PENDING,
      })
      mockModel.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([record])
      mockPeerly.getIdentityProfile.mockResolvedValueOnce(null)

      await service.runScan('slot')

      expect(mockModel.update).not.toHaveBeenCalled()
    })

    it('clears a stale profile status when getProfile 404s (identity gone)', async () => {
      const record = scanRecord('tcr-v', 9, {
        peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
        peerlyProfileStatus: PEERLY_PROFILE_STATUS_PENDING,
      })
      mockModel.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([record])
      mockPeerly.getIdentityProfile.mockRejectedValueOnce(
        new NotFoundException('identity gone'),
      )

      await service.runScan('slot')

      expect(mockModel.update).toHaveBeenCalledWith({
        where: { id: 'tcr-v' },
        data: {
          peerlyProfileStatus: null,
          peerlyProfileStatusChangedAt: expect.any(Date),
        },
      })
    })
  })
})
