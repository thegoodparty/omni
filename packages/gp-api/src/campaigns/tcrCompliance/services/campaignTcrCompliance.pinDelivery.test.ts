import { Test, TestingModule } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PinoLogger } from 'nestjs-pino'
import { PrismaService } from '@/prisma/prisma.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import {
  createMockCampaign,
  createMockUser,
} from '@/shared/test-utils/mockData.util'
import { CampaignTcrComplianceService } from './campaignTcrCompliance.service'
import { ComplianceStateService } from './complianceState.service'
import { PeerlyIdentityService } from '../../../vendors/peerly/services/peerlyIdentity.service'
import { WebsitesService } from '../../../websites/services/websites.service'
import { CampaignsService } from '../../services/campaigns.service'
import { CrmCampaignsService } from '../../services/crmCampaigns.service'
import { QueueProducerService } from '../../../queue/producer/queueProducer.service'
import { ExperimentRunsService } from '../../../agentExperiments/services/experimentRuns.service'

describe('CampaignTcrComplianceService - sweepPinDeliveryDetection', () => {
  const user = createMockUser({ id: 55 })
  const campaign = createMockCampaign({
    id: 900,
    userId: user.id,
    data: { hubspotId: 'company-1' },
  })
  const campaignWithUser = { ...campaign, user }
  const record = {
    id: 'tcr-1',
    campaignId: campaign.id,
    peerlyIdentityId: '11540083',
  }

  let service: CampaignTcrComplianceService
  let mockModel: {
    findMany: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  let mockPeerly: { retrieveCampaignVerifyDetails: ReturnType<typeof vi.fn> }
  let mockCampaigns: { findUnique: ReturnType<typeof vi.fn> }
  let mockTrack: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    mockModel = {
      findMany: vi.fn().mockResolvedValue([record]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    }
    mockPeerly = { retrieveCampaignVerifyDetails: vi.fn() }
    mockCampaigns = { findUnique: vi.fn().mockResolvedValue(campaignWithUser) }
    mockTrack = vi.fn().mockResolvedValue(undefined)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: { tcrCompliance: mockModel } },
        { provide: PeerlyIdentityService, useValue: mockPeerly },
        { provide: WebsitesService, useValue: {} },
        { provide: CampaignsService, useValue: mockCampaigns },
        { provide: CrmCampaignsService, useValue: {} },
        { provide: ComplianceStateService, useValue: {} },
        { provide: QueueProducerService, useValue: {} },
        { provide: ExperimentRunsService, useValue: {} },
        { provide: AnalyticsService, useValue: { track: mockTrack } },
        { provide: PinoLogger, useValue: createMockLogger() },
        CampaignTcrComplianceService,
      ],
    }).compile()

    service = module.get(CampaignTcrComplianceService)
  })

  it('records the channel + destination and fires the PIN Sent event once', async () => {
    mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValue({
      status: 'APPROVED',
      pinDelivery: { method: 'text', destination: '3126851162' },
    })

    await service.sweepPinDeliveryDetection()

    expect(mockModel.updateMany).toHaveBeenCalledWith({
      where: { id: 'tcr-1', pinSentDetectedAt: null },
      data: {
        pinDeliveryMethod: 'text',
        pinDeliveryDestination: '3126851162',
        pinSentDetectedAt: expect.any(Date),
      },
    })
    expect(mockTrack).toHaveBeenCalledTimes(1)
    expect(mockTrack).toHaveBeenCalledWith(
      user.id,
      EVENTS.Outreach.CompliancePinSent,
      expect.objectContaining({
        peerly_identity_id: '11540083',
        pin_delivery_method: 'text',
        pin_delivery_destination: '3126851162',
        company_hubspot_id: 'company-1',
      }),
    )
  })

  it('does not fire the event when another caller already claimed the record', async () => {
    mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValue({
      status: 'APPROVED',
      pinDelivery: { method: 'email', destination: 'a@b.com' },
    })
    mockModel.updateMany.mockResolvedValue({ count: 0 })

    await service.sweepPinDeliveryDetection()

    expect(mockTrack).not.toHaveBeenCalled()
  })

  it('does nothing when the PIN has not been sent yet', async () => {
    mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValue({
      status: 'IN_REVIEW',
      pinDelivery: null,
    })

    await service.sweepPinDeliveryDetection()

    expect(mockModel.updateMany).not.toHaveBeenCalled()
    expect(mockTrack).not.toHaveBeenCalled()
  })

  it('rolls back the claim when the event fails so a later sweep retries', async () => {
    mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValue({
      status: 'APPROVED',
      pinDelivery: { method: 'text', destination: '3126851162' },
    })
    mockTrack.mockRejectedValue(new Error('Segment down'))

    await service.sweepPinDeliveryDetection()

    // Claim, then rollback to null (scoped to the claim timestamp).
    expect(mockModel.updateMany).toHaveBeenCalledTimes(2)
    expect(mockModel.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'tcr-1', pinSentDetectedAt: expect.any(Date) },
      data: {
        pinDeliveryMethod: null,
        pinDeliveryDestination: null,
        pinSentDetectedAt: null,
      },
    })
  })

  it('sweeps both submitted and pending records so a fast PIN entry is not dropped', async () => {
    mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValue({
      status: 'APPROVED',
      pinDelivery: { method: 'email', destination: 'a@b.com' },
    })

    await service.sweepPinDeliveryDetection()

    expect(mockModel.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['submitted', 'pending'] },
        peerlyIdentityId: { not: null },
        pinDeliveryMethod: null,
      },
    })
  })

  it('does not crash the sweep when the rollback also fails', async () => {
    mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValue({
      status: 'APPROVED',
      pinDelivery: { method: 'text', destination: '3126851162' },
    })
    mockTrack.mockRejectedValue(new Error('Segment down'))
    mockModel.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim succeeds
      .mockRejectedValueOnce(new Error('DB down')) // rollback fails

    await expect(service.sweepPinDeliveryDetection()).resolves.toBeUndefined()
    // The rollback must have been attempted (claim + rollback = 2 calls); a
    // regression that skipped it would leave the record claimed-but-never-fired
    // and permanently excluded by the pinDeliveryMethod IS NULL filter.
    expect(mockModel.updateMany).toHaveBeenCalledTimes(2)
  })
})
