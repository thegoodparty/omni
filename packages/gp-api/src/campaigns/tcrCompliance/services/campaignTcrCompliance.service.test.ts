import { Test, TestingModule } from '@nestjs/testing'
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { subMinutes } from 'date-fns'
import { PeerlyBillingException } from '../../../vendors/peerly/utils/peerlyBillingError.util'
import { PeerlyCvRejectionException } from '../../../vendors/peerly/utils/peerlyCvRejection.util'
import {
  CommitteeType,
  ExperimentRunStatus,
  OfficeLevel,
  TcrComplianceStatus,
} from '../../../generated/prisma'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow, nthOrThrow } from 'src/shared/test-utils/arrays.util'
import { CampaignTcrComplianceService } from './campaignTcrCompliance.service'
import { ComplianceStateService } from './complianceState.service'
import { PeerlyIdentityService } from '../../../vendors/peerly/services/peerlyIdentity.service'
import { PeerlyCvVerificationStatus } from '../../../vendors/peerly/peerly.types'
import { WebsitesService } from '../../../websites/services/websites.service'
import { CampaignsService } from '../../services/campaigns.service'
import { CrmCampaignsService } from '../../services/crmCampaigns.service'
import { QueueProducerService } from '../../../queue/producer/queueProducer.service'
import { ExperimentRunsService } from '../../../agentExperiments/services/experimentRuns.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { PrismaService } from '@/prisma/prisma.service'
import { MessageGroup, QueueType } from '../../../queue/queue.types'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import {
  createMockUser,
  createMockCampaign,
} from '@/shared/test-utils/mockData.util'

describe('CampaignTcrComplianceService - createAgentic', () => {
  let service: CampaignTcrComplianceService
  let mockPeerly: { getIdentities: ReturnType<typeof vi.fn> }
  let mockWebsites: { findFirstOrThrow: ReturnType<typeof vi.fn> }
  let mockCampaigns: {
    updateJsonFields: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
  }
  let mockCrm: { trackCampaign: ReturnType<typeof vi.fn> }
  let mockComplianceState: {
    findStateForCampaign: ReturnType<typeof vi.fn>
  }
  let mockQueue: { sendMessage: ReturnType<typeof vi.fn> }
  let mockExperimentRuns: {
    findFirst: ReturnType<typeof vi.fn>
    dispatchRun: ReturnType<typeof vi.fn>
  }
  let mockModel: {
    findUnique: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    deleteMany: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  let mockPrisma: {
    tcrCompliance: typeof mockModel
    $transaction: ReturnType<typeof vi.fn>
  }

  const user = createMockUser({ clerkId: 'user_clerk_abc' })
  // isPro: true — these cases exercise the already-Pro path, where the kickoff
  // is enqueued immediately on submit (post-payment resubmit).
  const campaign = createMockCampaign({
    userId: user.id,
    formattedAddress: '123 Main St',
    isPro: true,
  })

  const basePayload = {
    ein: '12-3456789',
    committeeName: 'Test Committee',
    filingUrl: 'https://example.com/filing',
    email: 'test@example.com',
    phone: '5555555555',
    officeLevel: OfficeLevel.state,
    committeeType: CommitteeType.CANDIDATE,
    placeId: 'place-123',
    formattedAddress: '123 Main St',
  }

  beforeEach(async () => {
    mockPeerly = { getIdentities: vi.fn() }
    mockWebsites = { findFirstOrThrow: vi.fn() }
    mockCampaigns = {
      updateJsonFields: vi.fn().mockResolvedValue(campaign),
      findUnique: vi.fn().mockResolvedValue(campaign),
    }
    mockCrm = { trackCampaign: vi.fn().mockResolvedValue(undefined) }
    mockComplianceState = { findStateForCampaign: vi.fn() }
    mockQueue = { sendMessage: vi.fn().mockResolvedValue(undefined) }
    mockExperimentRuns = {
      findFirst: vi.fn().mockResolvedValue(null),
      dispatchRun: vi.fn().mockResolvedValue(undefined),
    }
    mockModel = {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'tcr-new', ...data }),
        ),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    }
    mockPrisma = {
      tcrCompliance: mockModel,
      $transaction: vi.fn(async (cb: (tx: typeof mockPrisma) => unknown) =>
        cb(mockPrisma),
      ),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PeerlyIdentityService, useValue: mockPeerly },
        { provide: WebsitesService, useValue: mockWebsites },
        { provide: CampaignsService, useValue: mockCampaigns },
        { provide: CrmCampaignsService, useValue: mockCrm },
        { provide: ComplianceStateService, useValue: mockComplianceState },
        { provide: QueueProducerService, useValue: mockQueue },
        { provide: ExperimentRunsService, useValue: mockExperimentRuns },
        { provide: PinoLogger, useValue: createMockLogger() },
        {
          provide: AnalyticsService,
          useValue: { track: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: SlackService,
          useValue: { errorMessage: vi.fn().mockResolvedValue('ok') },
        },
        CampaignTcrComplianceService,
      ],
    }).compile()

    service = module.get(CampaignTcrComplianceService)

    vi.clearAllMocks()
  })

  it('persists ein/committee/place fields, sharing the outer transaction', async () => {
    await service.createAgentic(user, campaign, {
      ...basePayload,
      websiteDomain: 'example.com',
    })

    expect(mockCampaigns.updateJsonFields).toHaveBeenCalledWith(
      campaign.id,
      {
        details: {
          einNumber: basePayload.ein,
          campaignCommittee: basePayload.committeeName,
        },
        placeId: basePayload.placeId,
        formattedAddress: basePayload.formattedAddress,
      },
      false,
      undefined,
      mockPrisma,
    )
    expect(mockCrm.trackCampaign).toHaveBeenCalledWith(campaign.id)
  })

  it('does not call CRM tracking if the transaction throws', async () => {
    mockCampaigns.updateJsonFields.mockResolvedValueOnce(null)

    await expect(
      service.createAgentic(user, campaign, basePayload),
    ).rejects.toThrow()
    expect(mockCrm.trackCampaign).not.toHaveBeenCalled()
  })

  it('still returns the record when CRM tracking fails after the kickoff', async () => {
    mockCrm.trackCampaign.mockRejectedValueOnce(new Error('HubSpot down'))

    const result = await service.createAgentic(user, campaign, basePayload)

    expect(mockQueue.sendMessage).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      record: expect.objectContaining({ id: 'tcr-new' }),
      created: true,
    })
  })

  it('claims kickoffSentAt atomically before sending the kickoff', async () => {
    await service.createAgentic(user, campaign, basePayload)

    expect(mockModel.updateMany).toHaveBeenCalledWith({
      where: { id: 'tcr-new', kickoffSentAt: null },
      data: { kickoffSentAt: expect.any(Date) },
    })
  })

  it('does not enqueue a second kickoff when the claim is already taken', async () => {
    mockModel.updateMany.mockResolvedValueOnce({ count: 0 })

    await service.createAgentic(user, campaign, basePayload)

    expect(mockQueue.sendMessage).not.toHaveBeenCalled()
  })

  it('marks the record error and re-throws if SQS sendMessage fails', async () => {
    const sqsErr = new Error('SQS unavailable')
    mockQueue.sendMessage.mockRejectedValueOnce(sqsErr)

    await expect(
      service.createAgentic(user, campaign, basePayload),
    ).rejects.toBe(sqsErr)

    // Claim is rolled back (kickoffSentAt back to null) so the sweep can retry
    expect(mockModel.updateMany).toHaveBeenCalledWith({
      where: { id: 'tcr-new', kickoffSentAt: expect.any(Date) },
      data: { kickoffSentAt: null },
    })
    expect(mockModel.update).toHaveBeenCalledWith({
      where: { id: 'tcr-new' },
      data: { status: TcrComplianceStatus.error },
    })
    expect(mockCrm.trackCampaign).not.toHaveBeenCalled()
  })

  it('preserves the original SQS error if the fallback status update also fails', async () => {
    const sqsErr = new Error('SQS unavailable')
    const updateErr = new Error('DB unavailable')
    mockQueue.sendMessage.mockRejectedValueOnce(sqsErr)
    mockModel.update.mockRejectedValueOnce(updateErr)

    await expect(
      service.createAgentic(user, campaign, basePayload),
    ).rejects.toBe(sqsErr)
  })

  it('sends the kickoff before tracking CRM (CRM failure cannot strand the record)', async () => {
    const callOrder: string[] = []
    mockQueue.sendMessage.mockImplementation(() => {
      callOrder.push('sendMessage')
      return Promise.resolve()
    })
    mockCrm.trackCampaign.mockImplementation(() => {
      callOrder.push('trackCampaign')
      return Promise.resolve()
    })

    await service.createAgentic(user, campaign, basePayload)

    expect(callOrder).toEqual(['sendMessage', 'trackCampaign'])
  })

  it('persists websiteDomain as empty string when missing', async () => {
    await service.createAgentic(user, campaign, basePayload)

    expect(mockModel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        websiteDomain: '',
        campaignId: campaign.id,
      }),
    })
  })

  it('does not call Peerly', async () => {
    await service.createAgentic(user, campaign, {
      ...basePayload,
      websiteDomain: 'example.com',
    })

    expect(mockPeerly.getIdentities).not.toHaveBeenCalled()
  })

  it('enqueues the agentic kickoff with only non-sensitive routing data', async () => {
    await service.createAgentic(user, campaign, basePayload)

    expect(mockQueue.sendMessage).toHaveBeenCalledTimes(1)
    const [message, group, options] = firstOrThrow(
      mockQueue.sendMessage.mock.calls,
    )
    expect(message).toEqual({
      type: QueueType.AGENTIC_COMPLIANCE_KICKOFF,
      data: {
        campaignId: campaign.id,
        tcrComplianceId: 'tcr-new',
        clerkUserId: user.clerkId,
      },
    })
    expect(group).toBe(
      `${MessageGroup.agenticComplianceKickoff}-${campaign.id}`,
    )
    expect(options).toEqual({
      deduplicationId: 'agentic-compliance-tcr-new',
      throwOnError: true,
    })
  })

  it('returns the existing record without re-kicking when one is in-flight', async () => {
    const existing = {
      id: 'tcr-existing',
      campaignId: campaign.id,
      status: TcrComplianceStatus.pending,
    }
    mockModel.findUnique.mockResolvedValue(existing)

    const result = await service.createAgentic(user, campaign, basePayload)

    expect(result).toEqual({ record: existing, created: false })
    expect(mockModel.create).not.toHaveBeenCalled()
    expect(mockCampaigns.updateJsonFields).not.toHaveBeenCalled()
    expect(mockQueue.sendMessage).not.toHaveBeenCalled()
  })

  it('restarts atomically (deleteMany + create in a transaction) on transient error', async () => {
    const existing = {
      id: 'tcr-failed',
      campaignId: campaign.id,
      status: TcrComplianceStatus.error,
    }
    mockModel.findUnique.mockResolvedValue(existing)

    await service.createAgentic(user, campaign, basePayload)

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockModel.deleteMany).toHaveBeenCalledWith({
      where: { id: 'tcr-failed' },
    })
    expect(mockModel.create).toHaveBeenCalledTimes(1)
    expect(mockQueue.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('restarts when the existing record was rejected (user is re-submitting corrected data)', async () => {
    const existing = {
      id: 'tcr-rejected',
      campaignId: campaign.id,
      status: TcrComplianceStatus.rejected,
    }
    mockModel.findUnique.mockResolvedValue(existing)

    await service.createAgentic(user, campaign, basePayload)

    expect(mockModel.deleteMany).toHaveBeenCalledWith({
      where: { id: 'tcr-rejected' },
    })
    expect(mockModel.create).toHaveBeenCalledTimes(1)
    expect(mockQueue.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('rolls back the delete when create fails inside the transaction', async () => {
    const existing = {
      id: 'tcr-failed',
      campaignId: campaign.id,
      status: TcrComplianceStatus.error,
    }
    mockModel.findUnique.mockResolvedValue(existing)
    const dbErr = new PrismaClientKnownRequestError('Connection lost', {
      code: 'P1001',
      clientVersion: 'test',
    })
    mockModel.create.mockRejectedValueOnce(dbErr)

    await expect(
      service.createAgentic(user, campaign, basePayload),
    ).rejects.toBe(dbErr)
    expect(mockQueue.sendMessage).not.toHaveBeenCalled()
  })

  it('returns the parallel record when a concurrent submission wins the race', async () => {
    const raced = {
      id: 'tcr-raced',
      campaignId: campaign.id,
      status: TcrComplianceStatus.submitted,
    }
    mockModel.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raced)
    mockModel.create.mockRejectedValueOnce(
      new PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )

    const result = await service.createAgentic(user, campaign, basePayload)

    expect(result).toEqual({ record: raced, created: false })
    expect(mockQueue.sendMessage).not.toHaveBeenCalled()
  })

  it('throws BadGatewayException when P2002 fires but no racing record is found', async () => {
    mockModel.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    mockModel.create.mockRejectedValueOnce(
      new PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )

    await expect(
      service.createAgentic(user, campaign, basePayload),
    ).rejects.toThrow(BadGatewayException)
    expect(mockQueue.sendMessage).not.toHaveBeenCalled()
  })

  it('rethrows non-P2002 Prisma errors from create', async () => {
    const otherErr = new PrismaClientKnownRequestError('Connection lost', {
      code: 'P1001',
      clientVersion: 'test',
    })
    mockModel.create.mockRejectedValueOnce(otherErr)

    await expect(
      service.createAgentic(user, campaign, basePayload),
    ).rejects.toBe(otherErr)
  })

  it('throws BadRequestException when the user has no Clerk ID', async () => {
    const userWithoutClerk = createMockUser({ clerkId: null })

    await expect(
      service.createAgentic(userWithoutClerk, campaign, basePayload),
    ).rejects.toThrow(BadRequestException)
  })

  it('persists the record but defers the kickoff when the campaign is not Pro', async () => {
    const nonProCampaign = createMockCampaign({
      userId: user.id,
      formattedAddress: '123 Main St',
      isPro: false,
    })

    const result = await service.createAgentic(
      user,
      nonProCampaign,
      basePayload,
    )

    expect(result.created).toBe(true)
    expect(mockModel.create).toHaveBeenCalledTimes(1)
    expect(mockModel.updateMany).not.toHaveBeenCalled()
    expect(mockQueue.sendMessage).not.toHaveBeenCalled()
  })

  describe('enqueueAgenticKickoffIfNeeded', () => {
    const paidRecord = {
      id: 'tcr-paid',
      campaignId: campaign.id,
      kickoffSentAt: null,
    }
    const campaignWithClerk = { ...campaign, user: { clerkId: 'clerk_paid' } }

    it('enqueues exactly one kickoff after payment for a deferred record', async () => {
      mockModel.findUnique.mockResolvedValueOnce(paidRecord)
      mockCampaigns.findUnique.mockResolvedValueOnce(campaignWithClerk)

      await service.enqueueAgenticKickoffIfNeeded(campaign.id)

      expect(mockModel.updateMany).toHaveBeenCalledWith({
        where: { id: 'tcr-paid', kickoffSentAt: null },
        data: { kickoffSentAt: expect.any(Date) },
      })
      expect(mockQueue.sendMessage).toHaveBeenCalledTimes(1)
      const [message] = firstOrThrow(mockQueue.sendMessage.mock.calls)
      expect(message.data).toEqual({
        campaignId: campaign.id,
        tcrComplianceId: 'tcr-paid',
        clerkUserId: 'clerk_paid',
      })
    })

    it('does not enqueue a second kickoff when the claim is already taken (replay)', async () => {
      mockModel.findUnique.mockResolvedValueOnce(paidRecord)
      mockCampaigns.findUnique.mockResolvedValueOnce(campaignWithClerk)
      mockModel.updateMany.mockResolvedValueOnce({ count: 0 })

      await service.enqueueAgenticKickoffIfNeeded(campaign.id)

      expect(mockQueue.sendMessage).not.toHaveBeenCalled()
    })

    it('does nothing when no TCR record exists yet (paid before filing)', async () => {
      mockModel.findUnique.mockResolvedValueOnce(null)

      await service.enqueueAgenticKickoffIfNeeded(campaign.id)

      expect(mockModel.updateMany).not.toHaveBeenCalled()
      expect(mockQueue.sendMessage).not.toHaveBeenCalled()
    })

    it('does nothing when the campaign has no Clerk user', async () => {
      mockModel.findUnique.mockResolvedValueOnce(paidRecord)
      mockCampaigns.findUnique.mockResolvedValueOnce({
        ...campaign,
        user: { clerkId: null },
      })

      await service.enqueueAgenticKickoffIfNeeded(campaign.id)

      expect(mockModel.updateMany).not.toHaveBeenCalled()
      expect(mockQueue.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('sweepStrandedAgenticKickoffs', () => {
    const sweep = (svc: CampaignTcrComplianceService) =>
      (
        svc as unknown as { sweepStrandedAgenticKickoffs: () => Promise<void> }
      ).sweepStrandedAgenticKickoffs()

    it('re-enqueues kickoff and stamps kickoffSentAt for stranded records', async () => {
      const stranded = {
        id: 'tcr-stranded',
        campaignId: 99,
        status: TcrComplianceStatus.submitted,
        peerlyIdentityId: null,
        kickoffSentAt: null,
        campaign: { user: { clerkId: 'clerk_stranded' } },
      }
      mockModel.findMany.mockResolvedValueOnce([stranded])

      await sweep(service)

      expect(mockModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: TcrComplianceStatus.submitted,
            peerlyIdentityId: null,
            kickoffSentAt: null,
            createdAt: { lt: expect.any(Date) },
            campaign: { isPro: true },
          },
        }),
      )
      expect(mockQueue.sendMessage).toHaveBeenCalledTimes(1)
      const [message, group, options] = firstOrThrow(
        mockQueue.sendMessage.mock.calls,
      )
      expect(message).toEqual({
        type: QueueType.AGENTIC_COMPLIANCE_KICKOFF,
        data: {
          campaignId: 99,
          tcrComplianceId: 'tcr-stranded',
          clerkUserId: 'clerk_stranded',
        },
      })
      expect(group).toBe(`${MessageGroup.agenticComplianceKickoff}-99`)
      expect(options.throwOnError).toBe(true)
      expect(options.deduplicationId).toMatch(
        /^agentic-compliance-tcr-stranded-recover-\d+$/,
      )
      expect(mockModel.update).toHaveBeenCalledWith({
        where: { id: 'tcr-stranded' },
        data: { kickoffSentAt: expect.any(Date) },
      })
    })

    it('skips records whose campaign user has no Clerk id', async () => {
      const stranded = {
        id: 'tcr-no-clerk',
        campaignId: 42,
        status: TcrComplianceStatus.submitted,
        peerlyIdentityId: null,
        kickoffSentAt: null,
        campaign: { user: { clerkId: null } },
      }
      mockModel.findMany.mockResolvedValueOnce([stranded])

      await sweep(service)

      expect(mockQueue.sendMessage).not.toHaveBeenCalled()
      expect(mockModel.update).not.toHaveBeenCalled()
    })

    it('continues after one record fails to re-enqueue', async () => {
      const a = {
        id: 'tcr-a',
        campaignId: 1,
        status: TcrComplianceStatus.submitted,
        peerlyIdentityId: null,
        kickoffSentAt: null,
        campaign: { user: { clerkId: 'clerk_a' } },
      }
      const b = {
        id: 'tcr-b',
        campaignId: 2,
        status: TcrComplianceStatus.submitted,
        peerlyIdentityId: null,
        kickoffSentAt: null,
        campaign: { user: { clerkId: 'clerk_b' } },
      }
      mockModel.findMany.mockResolvedValueOnce([a, b])
      mockQueue.sendMessage
        .mockRejectedValueOnce(new Error('SQS hiccup'))
        .mockResolvedValueOnce(undefined)

      await sweep(service)

      expect(mockQueue.sendMessage).toHaveBeenCalledTimes(2)
      expect(mockModel.update).toHaveBeenCalledTimes(1)
      expect(mockModel.update).toHaveBeenCalledWith({
        where: { id: 'tcr-b' },
        data: { kickoffSentAt: expect.any(Date) },
      })
    })

    it('is a no-op when no stranded records are found', async () => {
      mockModel.findMany.mockResolvedValueOnce([])

      await sweep(service)

      expect(mockQueue.sendMessage).not.toHaveBeenCalled()
      expect(mockModel.update).not.toHaveBeenCalled()
    })

    it('only sweeps Pro campaigns so pre-payment submissions are not dispatched', async () => {
      mockModel.findMany.mockResolvedValueOnce([])

      await sweep(service)

      expect(mockModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ campaign: { isPro: true } }),
        }),
      )
    })
  })
})

describe('CampaignTcrComplianceService - handleAgenticKickoff', () => {
  let service: CampaignTcrComplianceService
  let mockCampaigns: { findUnique: ReturnType<typeof vi.fn> }
  let mockExperimentRuns: {
    findUnique: ReturnType<typeof vi.fn>
    dispatchRun: ReturnType<typeof vi.fn>
  }
  let mockModel: {
    findUnique: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  let mockPrisma: { tcrCompliance: typeof mockModel }
  let mockWebsites: {
    ensureCompliancePublishableWebsite: ReturnType<typeof vi.fn>
  }

  const kickoff = {
    campaignId: 123,
    tcrComplianceId: 'tcr-abc',
    clerkUserId: 'user_clerk_abc',
  }
  const tcrRecord = {
    id: kickoff.tcrComplianceId,
    campaignId: kickoff.campaignId,
    agenticRunId: null,
    agenticDispatchAttemptedAt: null,
  }
  const campaignUser = createMockUser({
    firstName: 'Jane',
    lastName: 'Doe',
    clerkId: kickoff.clerkUserId,
  })
  const campaign = {
    ...createMockCampaign({
      id: kickoff.campaignId,
      userId: campaignUser.id,
      organizationSlug: 'org-jane-for-springfield',
      details: { electionDate: '2027-11-02' },
      placeId: 'place-123',
    }),
    user: campaignUser,
  }

  const dispatchedRun = { runId: 'run-dispatched-xyz' }

  beforeEach(async () => {
    mockCampaigns = { findUnique: vi.fn().mockResolvedValue(campaign) }
    mockExperimentRuns = {
      findUnique: vi.fn().mockResolvedValue(null),
      dispatchRun: vi.fn().mockResolvedValue(dispatchedRun),
    }
    mockModel = {
      findUnique: vi.fn().mockResolvedValue(tcrRecord),
      update: vi.fn().mockResolvedValue(tcrRecord),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    }
    mockPrisma = { tcrCompliance: mockModel }
    mockWebsites = {
      ensureCompliancePublishableWebsite: vi.fn().mockResolvedValue(undefined),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PeerlyIdentityService, useValue: {} },
        { provide: WebsitesService, useValue: mockWebsites },
        { provide: CampaignsService, useValue: mockCampaigns },
        { provide: CrmCampaignsService, useValue: {} },
        { provide: ComplianceStateService, useValue: {} },
        { provide: QueueProducerService, useValue: { sendMessage: vi.fn() } },
        { provide: ExperimentRunsService, useValue: mockExperimentRuns },
        { provide: PinoLogger, useValue: createMockLogger() },
        {
          provide: AnalyticsService,
          useValue: { track: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: SlackService,
          useValue: { errorMessage: vi.fn().mockResolvedValue('ok') },
        },
        CampaignTcrComplianceService,
      ],
    }).compile()

    service = module.get(CampaignTcrComplianceService)

    vi.clearAllMocks()
    mockCampaigns.findUnique.mockResolvedValue(campaign)
    mockExperimentRuns.findUnique.mockResolvedValue(null)
    mockExperimentRuns.dispatchRun.mockResolvedValue(dispatchedRun)
    mockModel.findUnique.mockResolvedValue(tcrRecord)
    mockModel.update.mockResolvedValue(tcrRecord)
    mockModel.updateMany.mockResolvedValue({ count: 1 })
    mockWebsites.ensureCompliancePublishableWebsite.mockResolvedValue(undefined)
  })

  it('provisions a publishable website before dispatching the agent', async () => {
    await service.handleAgenticKickoff(kickoff)

    expect(
      mockWebsites.ensureCompliancePublishableWebsite,
    ).toHaveBeenCalledWith(campaignUser, campaign)

    const provisionOrder =
      mockWebsites.ensureCompliancePublishableWebsite.mock
        .invocationCallOrder[0]
    const dispatchOrder = firstOrThrow(
      mockExperimentRuns.dispatchRun.mock.invocationCallOrder,
    )
    expect(provisionOrder).toBeLessThan(dispatchOrder)
  })

  it('claims the dispatch slot atomically before calling dispatchRun', async () => {
    await service.handleAgenticKickoff(kickoff)

    const claimCall = firstOrThrow(mockModel.updateMany.mock.calls)[0]
    expect(claimCall.where).toMatchObject({
      id: kickoff.tcrComplianceId,
      agenticRunId: null,
      OR: [
        { agenticDispatchAttemptedAt: null },
        { agenticDispatchAttemptedAt: { lt: expect.any(Date) } },
      ],
    })
    expect(claimCall.data.agenticDispatchAttemptedAt).toBeInstanceOf(Date)

    const dispatchCallOrder = firstOrThrow(
      mockExperimentRuns.dispatchRun.mock.invocationCallOrder,
    )
    const claimCallOrder = mockModel.updateMany.mock.invocationCallOrder[0]
    expect(claimCallOrder).toBeLessThan(dispatchCallOrder)
  })

  it('dispatches a compliance_setup run with manifest-shaped params', async () => {
    await service.handleAgenticKickoff(kickoff)

    expect(mockExperimentRuns.dispatchRun).toHaveBeenCalledWith({
      type: 'compliance_setup',
      organizationSlug: campaign.organizationSlug,
      clerkUserId: kickoff.clerkUserId,
      params: {
        campaign_id: kickoff.campaignId,
        candidate_first_name: 'Jane',
        candidate_last_name: 'Doe',
        clerk_user_id: kickoff.clerkUserId,
        election_date: '2027-11-02',
        trigger: 'initial',
      },
    })
  })

  it('stamps agenticRunId on the record scoped to the claim timestamp', async () => {
    await service.handleAgenticKickoff(kickoff)

    // Last updateMany is the success stamp; scoped to our claim timestamp so
    // a TTL re-claimant's stamp isn't clobbered.
    const stampCall = nthOrThrow(
      mockModel.updateMany.mock.calls,
      mockModel.updateMany.mock.calls.length - 1,
    )[0]
    expect(stampCall.where).toMatchObject({
      id: kickoff.tcrComplianceId,
      agenticDispatchAttemptedAt: expect.any(Date),
    })
    expect(stampCall.data).toEqual({ agenticRunId: dispatchedRun.runId })
  })

  it('logs an orphan when the claim expired before the success stamp lands', async () => {
    // Initial claim succeeds (count: 1); success stamp finds no matching row
    // (TTL re-claimant overwrote agenticDispatchAttemptedAt).
    mockModel.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    await service.handleAgenticKickoff(kickoff)

    expect(mockExperimentRuns.dispatchRun).toHaveBeenCalledTimes(1)
  })

  it('passes empty strings when candidate first/last name are null', async () => {
    mockCampaigns.findUnique.mockResolvedValueOnce({
      ...campaign,
      user: { ...campaignUser, firstName: null, lastName: null },
    })

    await service.handleAgenticKickoff(kickoff)

    const dispatchArg = firstOrThrow(
      mockExperimentRuns.dispatchRun.mock.calls,
    )[0]
    expect(dispatchArg.params.candidate_first_name).toBe('')
    expect(dispatchArg.params.candidate_last_name).toBe('')
  })

  it('does not include actor_token_url in the dispatch params', async () => {
    await service.handleAgenticKickoff(kickoff)

    const dispatchCall = firstOrThrow(
      mockExperimentRuns.dispatchRun.mock.calls,
    )[0]
    expect(JSON.stringify(dispatchCall)).not.toContain('actor_token_url')
    expect(JSON.stringify(dispatchCall)).not.toContain('actorTokenUrl')
  })

  it.each([
    ExperimentRunStatus.QUEUED,
    ExperimentRunStatus.RUNNING,
    ExperimentRunStatus.AWAITING_RESUME,
    ExperimentRunStatus.COMPLETED,
  ])(
    'skips dispatch when claim fails and existing run is %s',
    async (status) => {
      const recordWithRun = {
        ...tcrRecord,
        agenticRunId: 'run-existing',
      }
      mockModel.updateMany.mockResolvedValueOnce({ count: 0 })
      mockModel.findUnique
        .mockResolvedValueOnce(recordWithRun)
        .mockResolvedValueOnce(recordWithRun)
      mockExperimentRuns.findUnique.mockResolvedValueOnce({
        runId: 'run-existing',
        status,
      })

      await service.handleAgenticKickoff(kickoff)

      expect(mockExperimentRuns.dispatchRun).not.toHaveBeenCalled()
    },
  )

  it.each([ExperimentRunStatus.FAILED, ExperimentRunStatus.SUPERSEDED])(
    're-dispatches with trigger=recovery_resume when claim fails and ' +
      'existing run is %s',
    async (status) => {
      const recordWithRun = {
        ...tcrRecord,
        agenticRunId: 'run-prior',
      }
      mockModel.updateMany
        .mockResolvedValueOnce({ count: 0 }) // initial claim
        .mockResolvedValueOnce({ count: 1 }) // retake
        .mockResolvedValueOnce({ count: 1 }) // success stamp
      mockModel.findUnique
        .mockResolvedValueOnce(recordWithRun)
        .mockResolvedValueOnce(recordWithRun)
      mockExperimentRuns.findUnique.mockResolvedValueOnce({
        runId: 'run-prior',
        status,
      })

      await service.handleAgenticKickoff(kickoff)

      expect(mockExperimentRuns.dispatchRun).toHaveBeenCalledTimes(1)
      const dispatchArg = firstOrThrow(
        mockExperimentRuns.dispatchRun.mock.calls,
      )[0]
      expect(dispatchArg.params.trigger).toBe('recovery_resume')

      const retakeCall = nthOrThrow(mockModel.updateMany.mock.calls, 1)[0]
      expect(retakeCall.where).toMatchObject({
        id: kickoff.tcrComplianceId,
        agenticRunId: 'run-prior',
      })
      expect(retakeCall.data).toMatchObject({ agenticRunId: null })
    },
  )

  it('skips when claim fails and the FAILED retake loses the race', async () => {
    const recordWithRun = {
      ...tcrRecord,
      agenticRunId: 'run-failed',
    }
    mockModel.updateMany
      .mockResolvedValueOnce({ count: 0 }) // initial claim
      .mockResolvedValueOnce({ count: 0 }) // FAILED retake lost
    mockModel.findUnique
      .mockResolvedValueOnce(recordWithRun)
      .mockResolvedValueOnce(recordWithRun)
    mockExperimentRuns.findUnique.mockResolvedValueOnce({
      runId: 'run-failed',
      status: ExperimentRunStatus.FAILED,
    })

    await service.handleAgenticKickoff(kickoff)

    expect(mockExperimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('skips when claim fails, agenticRunId is set, but no experiment_run row is found', async () => {
    const recordWithRun = {
      ...tcrRecord,
      agenticRunId: 'run-orphan',
    }
    mockModel.updateMany.mockResolvedValueOnce({ count: 0 })
    mockModel.findUnique
      .mockResolvedValueOnce(recordWithRun)
      .mockResolvedValueOnce(recordWithRun)
    mockExperimentRuns.findUnique.mockResolvedValueOnce(null)

    await service.handleAgenticKickoff(kickoff)

    expect(mockExperimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('skips when claim fails because another worker holds an in-flight claim', async () => {
    mockModel.updateMany.mockResolvedValueOnce({ count: 0 })
    mockModel.findUnique.mockResolvedValueOnce({
      ...tcrRecord,
      agenticRunId: null,
      agenticDispatchAttemptedAt: new Date(),
    })

    await service.handleAgenticKickoff(kickoff)

    expect(mockExperimentRuns.dispatchRun).not.toHaveBeenCalled()
    expect(mockExperimentRuns.findUnique).not.toHaveBeenCalled()
  })

  it.each([
    { case: 'missing', details: {} },
    { case: 'wrong format (slashes)', details: { electionDate: '11/02/2027' } },
    { case: 'wrong format (long)', details: { electionDate: 'November 2027' } },
    { case: 'wrong format (empty)', details: { electionDate: '' } },
    { case: 'invalid date', details: { electionDate: '2027-13-99' } },
  ])(
    'marks the record as error and skips dispatch when electionDate is $case',
    async ({ details }) => {
      mockCampaigns.findUnique.mockResolvedValueOnce({
        ...campaign,
        details,
      })

      await service.handleAgenticKickoff(kickoff)

      expect(mockExperimentRuns.dispatchRun).not.toHaveBeenCalled()
      expect(mockModel.updateMany).toHaveBeenCalledWith({
        where: { id: kickoff.tcrComplianceId, agenticRunId: null },
        data: { status: TcrComplianceStatus.error },
      })
      expect(mockModel.update).not.toHaveBeenCalled()
    },
  )

  it.each([
    { case: 'null', placeId: null },
    { case: 'empty', placeId: '' },
    { case: 'whitespace only', placeId: '   ' },
  ])(
    'marks the record as error and skips dispatch when placeId is $case',
    async ({ placeId }) => {
      mockCampaigns.findUnique.mockResolvedValueOnce({
        ...campaign,
        placeId,
      })

      await service.handleAgenticKickoff(kickoff)

      expect(mockExperimentRuns.dispatchRun).not.toHaveBeenCalled()
      expect(
        mockWebsites.ensureCompliancePublishableWebsite,
      ).not.toHaveBeenCalled()
      expect(mockModel.updateMany).toHaveBeenCalledWith({
        where: { id: kickoff.tcrComplianceId, agenticRunId: null },
        data: { status: TcrComplianceStatus.error },
      })
      expect(mockModel.update).not.toHaveBeenCalled()
    },
  )

  it('does not overwrite status on a record that already has agenticRunId set when electionDate becomes invalid', async () => {
    mockCampaigns.findUnique.mockResolvedValueOnce({
      ...campaign,
      details: { electionDate: 'November 2027' },
    })
    // Simulate the prior successful dispatch having stamped agenticRunId.
    mockModel.updateMany.mockResolvedValueOnce({ count: 0 })

    await service.handleAgenticKickoff(kickoff)

    expect(mockExperimentRuns.dispatchRun).not.toHaveBeenCalled()
    // The updateMany ran but matched zero rows because the WHERE requires
    // agenticRunId: null — the live dispatch isn't disturbed.
    expect(mockModel.updateMany).toHaveBeenCalledWith({
      where: { id: kickoff.tcrComplianceId, agenticRunId: null },
      data: { status: TcrComplianceStatus.error },
    })
  })

  it('drops silently when the TcrCompliance record does not exist', async () => {
    mockModel.findUnique.mockResolvedValueOnce(null)

    await service.handleAgenticKickoff(kickoff)

    expect(mockExperimentRuns.dispatchRun).not.toHaveBeenCalled()
    expect(mockModel.updateMany).not.toHaveBeenCalled()
  })

  it('drops silently when the record belongs to a different campaign', async () => {
    mockModel.findUnique.mockResolvedValueOnce({
      ...tcrRecord,
      campaignId: tcrRecord.campaignId + 1,
    })

    await service.handleAgenticKickoff(kickoff)

    expect(mockExperimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('drops silently when the campaign does not exist', async () => {
    mockCampaigns.findUnique.mockResolvedValueOnce(null)

    await service.handleAgenticKickoff(kickoff)

    expect(mockExperimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('drops silently when the campaign has no user', async () => {
    mockCampaigns.findUnique.mockResolvedValueOnce({
      ...campaign,
      user: null,
    })

    await service.handleAgenticKickoff(kickoff)

    expect(mockExperimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('rolls back the claim scoped to its timestamp on dispatchRun throw', async () => {
    const err = new BadGatewayException('SQS dispatch failed')
    mockExperimentRuns.dispatchRun.mockRejectedValueOnce(err)

    await expect(service.handleAgenticKickoff(kickoff)).rejects.toBe(err)

    const claimTimestamp = firstOrThrow(mockModel.updateMany.mock.calls)[0].data
      .agenticDispatchAttemptedAt
    expect(mockModel.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: kickoff.tcrComplianceId,
        agenticRunId: null,
        agenticDispatchAttemptedAt: claimTimestamp,
      },
      data: { agenticDispatchAttemptedAt: null },
    })
    expect(mockModel.update).not.toHaveBeenCalled()
  })

  it('rolls back the claim and acks when dispatchRun returns no run', async () => {
    mockExperimentRuns.dispatchRun.mockResolvedValueOnce(undefined)

    await expect(service.handleAgenticKickoff(kickoff)).resolves.toBeUndefined()

    const claimTimestamp = firstOrThrow(mockModel.updateMany.mock.calls)[0].data
      .agenticDispatchAttemptedAt
    expect(mockModel.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: kickoff.tcrComplianceId,
        agenticRunId: null,
        agenticDispatchAttemptedAt: claimTimestamp,
      },
      data: { agenticDispatchAttemptedAt: null },
    })
    expect(mockModel.update).not.toHaveBeenCalled()
  })
})

describe('CampaignTcrComplianceService - submitToPeerlyForAgent', () => {
  let service: CampaignTcrComplianceService
  let mockPeerly: {
    getTCRIdentityName: ReturnType<typeof vi.fn>
    getIdentities: ReturnType<typeof vi.fn>
    createIdentity: ReturnType<typeof vi.fn>
    getIdentityProfile: ReturnType<typeof vi.fn>
    submitIdentityProfile: ReturnType<typeof vi.fn>
    submit10DlcBrand: ReturnType<typeof vi.fn>
    getCampaignVerifyRequest: ReturnType<typeof vi.fn>
    submitCampaignVerifyRequest: ReturnType<typeof vi.fn>
  }
  let mockComplianceState: {
    findStateForCampaign: ReturnType<typeof vi.fn>
    getStageForCampaign: ReturnType<typeof vi.fn>
  }
  let mockWebsites: {
    findFirstOrThrow: ReturnType<typeof vi.fn>
    getContentForCampaign: ReturnType<typeof vi.fn>
  }
  let mockTcrModel: {
    findUnique: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  let mockPrisma: {
    tcrCompliance: typeof mockTcrModel
    $transaction: ReturnType<typeof vi.fn>
  }
  let mockAnalytics: { track: ReturnType<typeof vi.fn> }

  const user = createMockUser({ clerkId: 'user_clerk_xyz' })
  const campaign = createMockCampaign({
    userId: user.id,
    formattedAddress: '123 Main St',
    placeId: 'place-123',
    details: { electionDate: '2026-11-03' },
  })

  // A real bio (well over MIN_BIO_LENGTH, no template marker) plus one real
  // issue, so the
  // content gate passes by default; individual tests override this to
  // exercise the generic-content rejection path.
  const genuineContent = {
    about: {
      bio: `<p>${'A'.repeat(600)}</p>`,
      issues: [{ title: 'Lower property taxes', description: 'A real plan' }],
    },
  }

  // The persisted record is now the sole source of every Peerly field — the
  // submit route takes no request body. These are the canonical values the
  // submit path reads and forwards to Peerly.
  const existingRecord = {
    id: 'tcr-existing',
    campaignId: campaign.id,
    ein: '12-3456789',
    committeeName: 'Jane for Springfield',
    websiteDomain: '',
    filingUrl: 'https://sos.example.gov/filing/jane',
    phone: '5555555555',
    email: 'jane@example.com',
    officeLevel: OfficeLevel.state,
    fecCommitteeId: null,
    committeeType: CommitteeType.CANDIDATE,
    status: TcrComplianceStatus.submitted,
    peerlyIdentityId: null,
    peerlyIdentityProfileLink: null,
    peerly10DLCBrandSubmissionKey: null,
    peerlyCvVerificationId: null,
    postalAddress: '123 Main St',
    kickoffSentAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    tdlcNumber: null,
    peerlyRegistrationLink: null,
  }

  beforeEach(async () => {
    mockPeerly = {
      getTCRIdentityName: vi.fn().mockReturnValue('Jane Doe - 12-3456789'),
      getIdentities: vi.fn().mockResolvedValue([]),
      createIdentity: vi.fn().mockResolvedValue({ identity_id: 'peerly-id-1' }),
      getIdentityProfile: vi.fn().mockResolvedValue(null),
      submitIdentityProfile: vi
        .fn()
        .mockResolvedValue({ link: 'https://peerly/profile/1', profile: {} }),
      submit10DlcBrand: vi.fn().mockResolvedValue('brand-key-1'),
      getCampaignVerifyRequest: vi.fn().mockResolvedValue(null),
      submitCampaignVerifyRequest: vi
        .fn()
        .mockResolvedValue({ verification_id: 'cv-verif-1', message: 'ok' }),
    }
    mockComplianceState = {
      findStateForCampaign: vi.fn().mockResolvedValue({
        stage: 'awaiting_pin',
        domain: null,
        websiteId: null,
        peerlyVerificationId: null,
        peerlyCvStatus: null,
      }),
      getStageForCampaign: vi.fn().mockResolvedValue('awaiting_pin'),
    }
    mockTcrModel = {
      findUnique: vi.fn().mockResolvedValue(existingRecord),
      update: vi.fn().mockImplementation(({ where, data }) =>
        Promise.resolve({
          ...existingRecord,
          ...data,
          id: where.id,
        }),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    }
    mockPrisma = {
      tcrCompliance: mockTcrModel,
      $transaction: vi.fn(async (cb: (tx: typeof mockPrisma) => unknown) =>
        cb(mockPrisma),
      ),
    }
    mockAnalytics = { track: vi.fn().mockResolvedValue(undefined) }
    mockWebsites = {
      // The submit path resolves the website host from the campaign's
      // registered domain (apex), not the request.
      findFirstOrThrow: vi
        .fn()
        .mockResolvedValue({ domain: { name: 'janedoe.com' } }),
      getContentForCampaign: vi.fn().mockResolvedValue(genuineContent),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PeerlyIdentityService, useValue: mockPeerly },
        {
          provide: WebsitesService,
          useValue: mockWebsites,
        },
        {
          provide: CampaignsService,
          useValue: { updateJsonFields: vi.fn() },
        },
        {
          provide: CrmCampaignsService,
          useValue: { trackCampaign: vi.fn() },
        },
        { provide: ComplianceStateService, useValue: mockComplianceState },
        {
          provide: QueueProducerService,
          useValue: { sendMessage: vi.fn() },
        },
        {
          provide: ExperimentRunsService,
          useValue: { findFirst: vi.fn(), dispatchRun: vi.fn() },
        },
        { provide: PinoLogger, useValue: createMockLogger() },
        { provide: AnalyticsService, useValue: mockAnalytics },
        {
          provide: SlackService,
          useValue: { errorMessage: vi.fn().mockResolvedValue('ok') },
        },
        CampaignTcrComplianceService,
      ],
    }).compile()

    service = module.get(CampaignTcrComplianceService)
  })

  it('throws NotFoundException when no TcrCompliance exists', async () => {
    mockTcrModel.findUnique.mockResolvedValueOnce(null)

    await expect(
      service.submitToPeerlyForAgent(user, campaign),
    ).rejects.toThrow(
      `TcrCompliance record not found for campaignId=${campaign.id}`,
    )

    expect(mockPeerly.getIdentities).not.toHaveBeenCalled()
  })

  it('is idempotent: returns existing record without calling Peerly when peerlyIdentityId is set', async () => {
    mockTcrModel.findUnique.mockResolvedValueOnce({
      ...existingRecord,
      peerlyIdentityId: 'peerly-already-set',
      peerlyIdentityProfileLink: 'https://peerly/profile/existing',
      peerly10DLCBrandSubmissionKey: 'brand-existing',
      peerlyCvVerificationId: 'cv-existing',
    })

    const result = await service.submitToPeerlyForAgent(user, campaign)

    expect(mockPeerly.getIdentities).not.toHaveBeenCalled()
    expect(mockPeerly.createIdentity).not.toHaveBeenCalled()
    expect(mockPeerly.submit10DlcBrand).not.toHaveBeenCalled()
    expect(mockPeerly.submitCampaignVerifyRequest).not.toHaveBeenCalled()
    expect(mockTcrModel.updateMany).not.toHaveBeenCalled()

    expect(result).toEqual({
      tcrComplianceId: existingRecord.id,
      peerlyIdentityId: 'peerly-already-set',
      peerlyIdentityProfileLink: 'https://peerly/profile/existing',
      peerly10DLCBrandSubmissionKey: 'brand-existing',
      peerlyVerificationId: 'cv-existing',
      stage: 'awaiting_pin',
      // Channels come from the persisted record so a retry cannot misreport
      // where Peerly sent the PIN.
      pinDeliveryChannels: {
        email: existingRecord.email,
        phone: existingRecord.phone,
      },
    })
  })

  it('canonicalizes the registered domain to the apex hostname (strips www.) for both Peerly fields and the DB', async () => {
    mockWebsites.findFirstOrThrow.mockResolvedValueOnce({
      domain: { name: 'www.janedoe.com' },
    })

    await service.submitToPeerlyForAgent(user, campaign)

    expect(mockPeerly.submit10DlcBrand).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ websiteDomain: 'janedoe.com' }),
      campaign,
      'janedoe.com',
    )
    expect(mockPeerly.submitCampaignVerifyRequest).toHaveBeenCalledWith(
      expect.any(Object),
      user,
      campaign,
      'janedoe.com',
    )
    expect(mockTcrModel.update).toHaveBeenCalledWith({
      where: { id: existingRecord.id },
      data: expect.objectContaining({ websiteDomain: 'janedoe.com' }),
    })
  })

  it('claims the submission slot atomically before calling Peerly', async () => {
    await service.submitToPeerlyForAgent(user, campaign)

    const firstUpdateMany = firstOrThrow(mockTcrModel.updateMany.mock.calls)
    expect(firstUpdateMany[0]).toEqual({
      where: {
        id: existingRecord.id,
        peerlyIdentityId: null,
        OR: [
          { peerlySubmissionStartedAt: null },
          { peerlySubmissionStartedAt: { lt: expect.any(Date) } },
        ],
      },
      data: { peerlySubmissionStartedAt: expect.any(Date) },
    })
    // Claim happens BEFORE Peerly is invoked
    const claimCallOrder = mockTcrModel.updateMany.mock.invocationCallOrder[0]
    const peerlyCallOrder = firstOrThrow(
      mockPeerly.getIdentities.mock.invocationCallOrder,
    )
    expect(claimCallOrder).toBeLessThan(peerlyCallOrder)
  })

  it('fires the event with the new identity id and the company hubspot id', async () => {
    const campaignWithHs = {
      ...campaign,
      data: { ...campaign.data, hubspotId: 'company-hs-1' },
    }

    await service.submitToPeerlyForAgent(user, campaignWithHs)

    expect(mockAnalytics.track).toHaveBeenCalledWith(
      user.id,
      EVENTS.Outreach.PeerlyIdentityIdCreated,
      {
        peerly_identity_id: 'peerly-id-1',
        company_hubspot_id: 'company-hs-1',
      },
    )
  })

  it('omits the company hubspot id when the company is not yet known', async () => {
    await service.submitToPeerlyForAgent(user, campaign)

    expect(mockAnalytics.track).toHaveBeenCalledWith(
      user.id,
      EVENTS.Outreach.PeerlyIdentityIdCreated,
      { peerly_identity_id: 'peerly-id-1' },
    )
  })

  it('does not fire the event when the Peerly identity already exists', async () => {
    mockPeerly.getIdentities.mockResolvedValueOnce([
      {
        identity_name: 'Jane Doe - 12-3456789',
        identity_id: 'peerly-existing-1',
      },
    ])

    await service.submitToPeerlyForAgent(user, campaign)

    expect(mockPeerly.createIdentity).not.toHaveBeenCalled()
    expect(mockAnalytics.track).not.toHaveBeenCalledWith(
      user.id,
      EVENTS.Outreach.PeerlyIdentityIdCreated,
      expect.anything(),
    )
  })

  it('submits to Peerly, persists results (including peerlyCvVerificationId), and returns awaiting_pin on the happy path', async () => {
    const result = await service.submitToPeerlyForAgent(user, campaign)

    expect(mockPeerly.submit10DlcBrand).toHaveBeenCalledWith(
      'peerly-id-1',
      expect.objectContaining({ websiteDomain: 'janedoe.com' }),
      campaign,
      'janedoe.com',
    )
    expect(mockPeerly.submitCampaignVerifyRequest).toHaveBeenCalledWith(
      expect.objectContaining({ peerlyIdentityId: 'peerly-id-1' }),
      user,
      campaign,
      'janedoe.com',
    )

    expect(mockTcrModel.update).toHaveBeenCalledWith({
      where: { id: existingRecord.id },
      data: expect.objectContaining({
        peerlyIdentityId: 'peerly-id-1',
        peerlyIdentityProfileLink: 'https://peerly/profile/1',
        peerly10DLCBrandSubmissionKey: 'brand-key-1',
        peerlyCvVerificationId: 'cv-verif-1',
        websiteDomain: 'janedoe.com',
      }),
    })

    expect(result).toEqual({
      tcrComplianceId: existingRecord.id,
      peerlyIdentityId: 'peerly-id-1',
      peerlyIdentityProfileLink: 'https://peerly/profile/1',
      peerly10DLCBrandSubmissionKey: 'brand-key-1',
      peerlyVerificationId: 'cv-verif-1',
      stage: 'awaiting_pin',
      pinDeliveryChannels: {
        email: existingRecord.email,
        phone: existingRecord.phone,
      },
    })
  })

  it('sources ein/committee/filing/contact fields from the persisted record, not the request', async () => {
    await service.submitToPeerlyForAgent(user, campaign)

    // The submit path takes no request body; every value handed to Peerly
    // comes off the persisted TcrCompliance row.
    expect(mockPeerly.submitCampaignVerifyRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        ein: existingRecord.ein,
        filingUrl: existingRecord.filingUrl,
        email: existingRecord.email,
        phone: existingRecord.phone,
        officeLevel: existingRecord.officeLevel,
      }),
      user,
      campaign,
      'janedoe.com',
    )
    expect(mockPeerly.submit10DlcBrand).toHaveBeenCalledWith(
      'peerly-id-1',
      expect.objectContaining({
        ein: existingRecord.ein,
        committeeName: existingRecord.committeeName,
        filingUrl: existingRecord.filingUrl,
      }),
      campaign,
      'janedoe.com',
    )
  })

  it('rejects a persisted goodparty.org filing URL before claiming or calling Peerly', async () => {
    mockTcrModel.findUnique.mockResolvedValueOnce({
      ...existingRecord,
      filingUrl: 'https://goodparty.org/candidate/jane',
    })

    await expect(
      service.submitToPeerlyForAgent(user, campaign),
    ).rejects.toThrow(/goodparty\.org/i)

    // Guard fires before the pre-Peerly claim and any Peerly call.
    expect(mockPeerly.getIdentities).not.toHaveBeenCalled()
    expect(mockTcrModel.updateMany).not.toHaveBeenCalled()
    expect(mockTcrModel.update).not.toHaveBeenCalled()
  })

  it('falls back to the persisted FEC committee id when a federal record omits it in the request', async () => {
    mockTcrModel.findUnique.mockResolvedValueOnce({
      ...existingRecord,
      officeLevel: OfficeLevel.federal,
      committeeType: CommitteeType.HOUSE,
      fecCommitteeId: 'C00936328',
      filingUrl: 'https://www.fec.gov/data/committee/C00936328/',
    })

    const result = await service.submitToPeerlyForAgent(user, campaign)

    // The 10DLC brand is submitted with the stored committee id.
    expect(mockPeerly.submit10DlcBrand).toHaveBeenCalledWith(
      'peerly-id-1',
      expect.objectContaining({ fecCommitteeId: 'C00936328' }),
      campaign,
      'janedoe.com',
    )
    expect(result.stage).toBe('awaiting_pin')
  })

  it('throws when a federal record has no FEC committee id persisted', async () => {
    mockTcrModel.findUnique.mockResolvedValueOnce({
      ...existingRecord,
      officeLevel: OfficeLevel.federal,
      committeeType: CommitteeType.HOUSE,
      fecCommitteeId: null,
      filingUrl: 'https://www.fec.gov/data/committee/',
    })

    await expect(
      service.submitToPeerlyForAgent(user, campaign),
    ).rejects.toThrow('FEC Committee ID is required for federal office level')

    // Fails before claiming the slot or calling Peerly.
    expect(mockPeerly.getIdentities).not.toHaveBeenCalled()
    expect(mockTcrModel.updateMany).not.toHaveBeenCalled()
  })

  it('throws ConflictException when claim is taken and the in-flight call has not yet persisted peerlyIdentityId', async () => {
    mockTcrModel.updateMany.mockResolvedValueOnce({ count: 0 })
    mockTcrModel.findUnique
      .mockResolvedValueOnce(existingRecord)
      .mockResolvedValueOnce(existingRecord)

    await expect(
      service.submitToPeerlyForAgent(user, campaign),
    ).rejects.toThrow('A Peerly submission is already in progress')

    expect(mockPeerly.getIdentities).not.toHaveBeenCalled()
  })

  it('returns idempotent response when claim is taken because a concurrent call already completed', async () => {
    mockTcrModel.updateMany.mockResolvedValueOnce({ count: 0 })
    const winner = {
      ...existingRecord,
      peerlyIdentityId: 'peerly-winner',
      peerlyIdentityProfileLink: 'https://peerly/profile/winner',
      peerly10DLCBrandSubmissionKey: 'brand-winner',
      peerlyCvVerificationId: 'cv-winner',
    }
    mockTcrModel.findUnique
      .mockResolvedValueOnce(existingRecord)
      .mockResolvedValueOnce(winner)

    const result = await service.submitToPeerlyForAgent(user, campaign)

    expect(mockPeerly.getIdentities).not.toHaveBeenCalled()
    expect(result).toEqual({
      tcrComplianceId: winner.id,
      peerlyIdentityId: 'peerly-winner',
      peerlyIdentityProfileLink: 'https://peerly/profile/winner',
      peerly10DLCBrandSubmissionKey: 'brand-winner',
      peerlyVerificationId: 'cv-winner',
      stage: 'awaiting_pin',
      pinDeliveryChannels: { email: winner.email, phone: winner.phone },
    })
  })

  it('rolls back only this callers own claim (matched by timestamp) and rethrows when Peerly fails', async () => {
    const peerlyErr = new BadGatewayException('Peerly down')
    mockPeerly.createIdentity.mockRejectedValueOnce(peerlyErr)

    await expect(service.submitToPeerlyForAgent(user, campaign)).rejects.toBe(
      peerlyErr,
    )

    // Two updateMany calls: claim, then rollback
    expect(mockTcrModel.updateMany).toHaveBeenCalledTimes(2)
    const claimCall = firstOrThrow(mockTcrModel.updateMany.mock.calls)[0]
    const rollbackCall = nthOrThrow(mockTcrModel.updateMany.mock.calls, 1)[0]
    const claimTimestamp = claimCall.data.peerlySubmissionStartedAt
    expect(claimTimestamp).toBeInstanceOf(Date)
    // Rollback scopes to the exact timestamp we wrote, so a TTL re-claim by
    // another caller would NOT be cleared by our rollback.
    expect(rollbackCall).toEqual({
      where: {
        id: existingRecord.id,
        peerlyIdentityId: null,
        peerlySubmissionStartedAt: claimTimestamp,
      },
      data: { peerlySubmissionStartedAt: null },
    })
    // Final write never happens on the failure path
    expect(mockTcrModel.update).not.toHaveBeenCalled()
  })

  it('throws UnprocessableEntityException when compliance stage is not awaiting_pin (website not yet live)', async () => {
    mockComplianceState.getStageForCampaign.mockResolvedValueOnce(
      'pending_website_live',
    )

    await expect(
      service.submitToPeerlyForAgent(user, campaign),
    ).rejects.toThrow(
      'Cannot submit TCR registration to Peerly until the candidate',
    )

    expect(mockPeerly.getIdentities).not.toHaveBeenCalled()
    expect(mockTcrModel.updateMany).not.toHaveBeenCalled()
    expect(mockTcrModel.update).not.toHaveBeenCalled()
  })

  it('refuses to submit when website content is generic', async () => {
    mockWebsites.getContentForCampaign.mockResolvedValueOnce({
      about: { bio: '<p>short</p>', issues: [] },
    })
    const peerlySpy = vi.spyOn(
      service as unknown as { submitToPeerly: () => Promise<never> },
      'submitToPeerly',
    )

    await expect(
      service.submitToPeerlyForAgent(user, campaign),
    ).rejects.toThrow(/genuine/i)

    expect(peerlySpy).not.toHaveBeenCalled()
    expect(mockTcrModel.updateMany).not.toHaveBeenCalled()
    expect(mockTcrModel.update).not.toHaveBeenCalled()
  })

  it('does not throw or 500 when about.issues has a genuine issue mixed with a malformed (null) entry', async () => {
    mockWebsites.getContentForCampaign.mockResolvedValueOnce({
      about: {
        bio: `<p>${'A'.repeat(600)}</p>`,
        issues: [
          { title: 'Lower property taxes', description: 'A real plan' },
          null,
        ],
      },
    })

    await expect(
      service.submitToPeerlyForAgent(user, campaign),
    ).resolves.not.toThrow()

    expect(mockTcrModel.updateMany).toHaveBeenCalled()
  })

  it('preserves persisted peerlyCvVerificationId when Peerly already has a CV request (existing-CV branch)', async () => {
    // Existing record carries a CV id from a prior partial run.
    const recordWithExistingCv = {
      ...existingRecord,
      peerlyCvVerificationId: 'cv-existing-from-prior-run',
    }
    mockTcrModel.findUnique.mockResolvedValueOnce(recordWithExistingCv)

    // Peerly's GET shows an existing CV request, so the helper skips submit
    // and returns null for cvVerificationId (the GET response shape carries
    // no verification_id).
    mockPeerly.getCampaignVerifyRequest.mockResolvedValueOnce({
      verification_status: 'pending',
    })

    const result = await service.submitToPeerlyForAgent(user, campaign)

    expect(mockPeerly.submitCampaignVerifyRequest).not.toHaveBeenCalled()
    expect(mockTcrModel.update).toHaveBeenCalledWith({
      where: { id: recordWithExistingCv.id },
      data: expect.objectContaining({
        peerlyCvVerificationId: 'cv-existing-from-prior-run',
      }),
    })
    expect(result.peerlyVerificationId).toBe('cv-existing-from-prior-run')
  })

  it('surfaces BadRequestException and rolls back claim when campaignCommittee is absent (real submit10DlcBrand guard)', async () => {
    // The real PeerlyIdentityService.submit10DlcBrand throws this when
    // campaign.details.campaignCommittee is missing. The rest of this suite
    // mocks the helper away; this test forces the real production-path error
    // so we exercise error propagation + claim rollback.
    const missingCommitteeErr = new BadRequestException(
      'Campaign committee is required to submit 10DLC brand',
    )
    mockPeerly.submit10DlcBrand.mockRejectedValueOnce(missingCommitteeErr)

    await expect(service.submitToPeerlyForAgent(user, campaign)).rejects.toBe(
      missingCommitteeErr,
    )

    // Two updateMany calls: claim, then rollback scoped to our own timestamp.
    expect(mockTcrModel.updateMany).toHaveBeenCalledTimes(2)
    const claimCall = firstOrThrow(mockTcrModel.updateMany.mock.calls)[0]
    const rollbackCall = nthOrThrow(mockTcrModel.updateMany.mock.calls, 1)[0]
    expect(rollbackCall).toEqual({
      where: {
        id: existingRecord.id,
        peerlyIdentityId: null,
        peerlySubmissionStartedAt: claimCall.data.peerlySubmissionStartedAt,
      },
      data: { peerlySubmissionStartedAt: null },
    })
    // Final write never happens on the failure path.
    expect(mockTcrModel.update).not.toHaveBeenCalled()
  })

  it('fails fast with BadRequestException when the campaign has no placeId', async () => {
    // No placeId means Peerly's address resolution (getAddressByPlaceId) would
    // 502, which the agent treats as transient and retries forever (campaign
    // 325553). Fail fast with a 4xx instead, before any Peerly call.
    const noAddressCampaign = createMockCampaign({
      userId: user.id,
      formattedAddress: '',
      placeId: '',
      details: { electionDate: '2026-11-03' },
    })

    await expect(
      service.submitToPeerlyForAgent(user, noAddressCampaign),
    ).rejects.toThrow(BadRequestException)

    expect(mockPeerly.getIdentities).not.toHaveBeenCalled()
    expect(mockPeerly.submit10DlcBrand).not.toHaveBeenCalled()
    // Guard fires inside submitToPeerly, after the claim, so the claim is
    // taken (updateMany #1) then rolled back (updateMany #2). Asserting this
    // catches a refactor that moves the guard before the claim and silently
    // breaks the lock rollback.
    expect(mockTcrModel.updateMany).toHaveBeenCalledTimes(2)
    expect(mockTcrModel.update).not.toHaveBeenCalled()
  })

  it('stamps peerlyBillingBlockedAt and rethrows when Peerly reports the billing failure', async () => {
    // submitCampaignVerifyRequest throws PeerlyBillingException on the
    // unrecoverable "No payment method available" billing error.
    const billingErr = new PeerlyBillingException('billing hold')
    mockPeerly.submitCampaignVerifyRequest.mockRejectedValueOnce(billingErr)

    await expect(service.submitToPeerlyForAgent(user, campaign)).rejects.toBe(
      billingErr,
    )

    // Claim rolled back (updateMany #2), then the billing block is stamped —
    // both inside the one rollback transaction.
    expect(mockTcrModel.updateMany).toHaveBeenCalledTimes(2)
    expect(mockTcrModel.update).toHaveBeenCalledWith({
      where: { id: existingRecord.id },
      data: { peerlyBillingBlockedAt: expect.any(Date) },
    })
  })

  it('marks the record rejected, fires the rejection event, and rethrows on a CV data rejection', async () => {
    const cvErr = new PeerlyCvRejectionException(
      'Campaign Verify rejected the submission: FEC filing URLs are not allowed.',
    )
    mockPeerly.submitCampaignVerifyRequest.mockRejectedValueOnce(cvErr)

    await expect(service.submitToPeerlyForAgent(user, campaign)).rejects.toBe(
      cvErr,
    )

    // Claim (updateMany #1) then rollback (updateMany #2), same as the
    // billing path — the rejected stamp must not leave the claim held.
    expect(mockTcrModel.updateMany).toHaveBeenCalledTimes(2)
    expect(mockTcrModel.update).toHaveBeenCalledWith({
      where: { id: existingRecord.id },
      data: { status: 'rejected' },
    })
    expect(mockAnalytics.track).toHaveBeenCalledWith(
      user.id,
      EVENTS.Outreach.ComplianceRejected,
      expect.objectContaining({
        rejection_source: 'cv_submit',
        rejection_reason: cvErr.message,
      }),
    )
  })

  it('does not fire the rejection event when the rejected stamp fails to commit', async () => {
    // If the rollback transaction fails, the record stays non-rejected and
    // the deterministic retry would fire the event again — so no stamp, no
    // event.
    const cvErr = new PeerlyCvRejectionException(
      'Campaign Verify rejected the submission: FEC filing URLs are not allowed.',
    )
    mockPeerly.submitCampaignVerifyRequest.mockRejectedValueOnce(cvErr)
    mockPrisma.$transaction.mockRejectedValueOnce(new Error('connection lost'))

    await expect(service.submitToPeerlyForAgent(user, campaign)).rejects.toBe(
      cvErr,
    )

    const rejectionFires = mockAnalytics.track.mock.calls.filter(
      (call) => call[1] === EVENTS.Outreach.ComplianceRejected,
    )
    expect(rejectionFires).toHaveLength(0)
  })

  it('holds off re-submitting (no Peerly call) while the billing block is within cooldown', async () => {
    mockTcrModel.findUnique.mockResolvedValueOnce({
      ...existingRecord,
      peerlyBillingBlockedAt: new Date(),
    })

    await expect(
      service.submitToPeerlyForAgent(user, campaign),
    ).rejects.toThrow(ServiceUnavailableException)

    // The retry storm is broken: no Peerly submission, no claim write.
    expect(mockPeerly.getIdentities).not.toHaveBeenCalled()
    expect(mockPeerly.submitCampaignVerifyRequest).not.toHaveBeenCalled()
    expect(mockTcrModel.updateMany).not.toHaveBeenCalled()
  })

  it('retries normally once the billing block is older than the cooldown', async () => {
    mockTcrModel.findUnique.mockResolvedValueOnce({
      ...existingRecord,
      peerlyBillingBlockedAt: subMinutes(new Date(), 6 * 60 + 1),
    })

    await service.submitToPeerlyForAgent(user, campaign)

    expect(mockPeerly.submitCampaignVerifyRequest).toHaveBeenCalledTimes(1)
    // A successful submit clears any prior billing hold.
    expect(mockTcrModel.update).toHaveBeenCalledWith({
      where: { id: existingRecord.id },
      data: expect.objectContaining({ peerlyBillingBlockedAt: null }),
    })
  })
})

describe('CampaignTcrComplianceService - create (legacy) placeId guard', () => {
  let service: CampaignTcrComplianceService
  let mockPeerly: { getIdentities: ReturnType<typeof vi.fn> }
  let mockWebsites: { findFirstOrThrow: ReturnType<typeof vi.fn> }

  const user = createMockUser({ clerkId: 'user_clerk_legacy' })
  // CreateTcrCompliancePayload omits placeId/formattedAddress (they live on the
  // campaign); the guard reads campaign.placeId, not the payload.
  const payload = {
    ein: '12-3456789',
    committeeName: 'Jane for Springfield',
    filingUrl: 'https://example.gov/filing/123',
    email: 'jane@example.com',
    phone: '5555555555',
    officeLevel: OfficeLevel.state,
    fecCommitteeId: undefined,
    committeeType: CommitteeType.CANDIDATE,
    websiteDomain: 'vote-jane.site',
  }

  beforeEach(async () => {
    mockPeerly = { getIdentities: vi.fn().mockResolvedValue([]) }
    mockWebsites = {
      findFirstOrThrow: vi
        .fn()
        .mockResolvedValue({ domain: { name: 'vote-jane.site' } }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: { tcrCompliance: {} } },
        { provide: PeerlyIdentityService, useValue: mockPeerly },
        { provide: WebsitesService, useValue: mockWebsites },
        { provide: CampaignsService, useValue: { updateJsonFields: vi.fn() } },
        { provide: CrmCampaignsService, useValue: { trackCampaign: vi.fn() } },
        {
          provide: ComplianceStateService,
          useValue: { findStateForCampaign: vi.fn() },
        },
        { provide: QueueProducerService, useValue: { sendMessage: vi.fn() } },
        { provide: ExperimentRunsService, useValue: { dispatchRun: vi.fn() } },
        { provide: PinoLogger, useValue: createMockLogger() },
        {
          provide: AnalyticsService,
          useValue: { track: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: SlackService,
          useValue: { errorMessage: vi.fn().mockResolvedValue('ok') },
        },
        CampaignTcrComplianceService,
      ],
    }).compile()
    service = module.get(CampaignTcrComplianceService)
  })

  it('fails fast with BadRequestException when the campaign has no placeId', async () => {
    const noAddressCampaign = createMockCampaign({
      userId: user.id,
      placeId: '',
      formattedAddress: '',
      details: { electionDate: '2026-11-03' },
    })

    await expect(
      service.create(user, noAddressCampaign, payload),
    ).rejects.toThrow(BadRequestException)

    // Fails inside submitToPeerly before any Peerly call.
    expect(mockPeerly.getIdentities).not.toHaveBeenCalled()
  })
})

describe('CampaignTcrComplianceService - PIN submission non-prod bypass', () => {
  let service: CampaignTcrComplianceService
  let mockPeerly: {
    verifyCampaignVerifyPin: ReturnType<typeof vi.fn>
    createCampaignVerifyToken: ReturnType<typeof vi.fn>
    submitCampaignVerifyTokenToBrand: ReturnType<typeof vi.fn>
    retrieveCampaignVerifyStatus: ReturnType<typeof vi.fn>
  }
  let mockModel: { findFirstOrThrow: ReturnType<typeof vi.fn> }
  let mockPrisma: { tcrCompliance: typeof mockModel }

  const tcrCompliance = {
    id: 'tcr-1',
    peerlyIdentityId: null,
  } as unknown as Parameters<
    CampaignTcrComplianceService['retrieveCampaignVerifyToken']
  >[1]

  beforeEach(async () => {
    mockPeerly = {
      verifyCampaignVerifyPin: vi.fn(),
      createCampaignVerifyToken: vi.fn(),
      submitCampaignVerifyTokenToBrand: vi.fn(),
      retrieveCampaignVerifyStatus: vi.fn(),
    }
    mockModel = { findFirstOrThrow: vi.fn() }
    mockPrisma = { tcrCompliance: mockModel }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PeerlyIdentityService, useValue: mockPeerly },
        {
          provide: WebsitesService,
          useValue: { findFirstOrThrow: vi.fn() },
        },
        {
          provide: CampaignsService,
          useValue: { updateJsonFields: vi.fn() },
        },
        {
          provide: CrmCampaignsService,
          useValue: { trackCampaign: vi.fn() },
        },
        {
          provide: ComplianceStateService,
          useValue: { findStateForCampaign: vi.fn() },
        },
        {
          provide: QueueProducerService,
          useValue: { sendMessage: vi.fn() },
        },
        {
          provide: ExperimentRunsService,
          useValue: { findFirst: vi.fn(), dispatchRun: vi.fn() },
        },
        { provide: PinoLogger, useValue: createMockLogger() },
        {
          provide: AnalyticsService,
          useValue: { track: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: SlackService,
          useValue: { errorMessage: vi.fn().mockResolvedValue('ok') },
        },
        CampaignTcrComplianceService,
      ],
    }).compile()

    service = module.get(CampaignTcrComplianceService)
  })

  const withEnv = async (
    value: string | undefined,
    body: () => Promise<void>,
  ) => {
    const original = process.env.OTEL_SERVICE_ENVIRONMENT
    if (value === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = value
    try {
      await body()
    } finally {
      if (original === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
      else process.env.OTEL_SERVICE_ENVIRONMENT = original
    }
  }

  it('retrieveCampaignVerifyToken short-circuits in non-prod without calling Peerly', async () => {
    await withEnv('dev', async () => {
      const token = await service.retrieveCampaignVerifyToken(
        'any-pin',
        tcrCompliance,
      )

      expect(token).toBe('non-prod-bypass-cv-token')
      expect(mockPeerly.verifyCampaignVerifyPin).not.toHaveBeenCalled()
      expect(mockPeerly.createCampaignVerifyToken).not.toHaveBeenCalled()
      expect(mockModel.findFirstOrThrow).not.toHaveBeenCalled()
    })
  })

  it('retrieveCampaignVerifyToken short-circuits in qa too', async () => {
    await withEnv('qa', async () => {
      const token = await service.retrieveCampaignVerifyToken(
        'any-pin',
        tcrCompliance,
      )
      expect(token).toBe('non-prod-bypass-cv-token')
      expect(mockPeerly.verifyCampaignVerifyPin).not.toHaveBeenCalled()
    })
  })

  it('submitCampaignVerifyToken short-circuits in non-prod without calling Peerly', async () => {
    await withEnv('dev', async () => {
      const result = await service.submitCampaignVerifyToken(
        tcrCompliance,
        'token',
      )

      expect(result).toBeUndefined()
      expect(mockPeerly.submitCampaignVerifyTokenToBrand).not.toHaveBeenCalled()
    })
  })

  it('retrieveCampaignVerifyToken calls Peerly when OTEL_SERVICE_ENVIRONMENT=prod', async () => {
    await withEnv('prod', async () => {
      await expect(
        service.retrieveCampaignVerifyToken('any-pin', tcrCompliance),
      ).rejects.toThrow(BadRequestException)
      // peerlyIdentityId is null on the stub, so we hit the original guard
      // — proving the bypass did not intercept.
    })
  })

  it('submitCampaignVerifyToken calls Peerly when OTEL_SERVICE_ENVIRONMENT=prod', async () => {
    mockPeerly.submitCampaignVerifyTokenToBrand.mockResolvedValueOnce({
      brand: 'ok',
    })
    await withEnv('prod', async () => {
      const result = await service.submitCampaignVerifyToken(
        tcrCompliance,
        'token',
      )
      expect(result).toEqual({ brand: 'ok' })
      expect(mockPeerly.submitCampaignVerifyTokenToBrand).toHaveBeenCalledWith(
        tcrCompliance,
        'token',
      )
    })
  })

  const tcrWithIdentity = {
    id: 'tcr-2',
    peerlyIdentityId: 'peerly-1',
  } as unknown as Parameters<
    CampaignTcrComplianceService['retrieveCampaignVerifyToken']
  >[1]

  it('retrieveCampaignVerifyToken verifies the PIN when the CV is not yet VERIFIED', async () => {
    mockModel.findFirstOrThrow.mockResolvedValueOnce({ campaign: { id: 1 } })
    mockPeerly.retrieveCampaignVerifyStatus.mockResolvedValueOnce('APPROVED')
    mockPeerly.verifyCampaignVerifyPin.mockResolvedValueOnce(true)
    mockPeerly.createCampaignVerifyToken.mockResolvedValueOnce('cv-token')

    await withEnv('prod', async () => {
      const token = await service.retrieveCampaignVerifyToken(
        '123456',
        tcrWithIdentity,
      )

      expect(token).toBe('cv-token')
      expect(mockPeerly.verifyCampaignVerifyPin).toHaveBeenCalledWith(
        'peerly-1',
        '123456',
        { id: 1 },
      )
    })
  })

  it('retrieveCampaignVerifyToken throws Invalid PIN for a wrong PIN on a non-VERIFIED CV', async () => {
    mockModel.findFirstOrThrow.mockResolvedValueOnce({ campaign: { id: 1 } })
    mockPeerly.retrieveCampaignVerifyStatus.mockResolvedValueOnce('APPROVED')
    mockPeerly.verifyCampaignVerifyPin.mockResolvedValueOnce(false)

    await withEnv('prod', async () => {
      await expect(
        service.retrieveCampaignVerifyToken('000000', tcrWithIdentity),
      ).rejects.toThrow(UnprocessableEntityException)
      expect(mockPeerly.createCampaignVerifyToken).not.toHaveBeenCalled()
    })
  })

  it('retrieveCampaignVerifyToken skips PIN re-verification and mints a token when the CV is already VERIFIED', async () => {
    mockModel.findFirstOrThrow.mockResolvedValueOnce({ campaign: { id: 1 } })
    mockPeerly.retrieveCampaignVerifyStatus.mockResolvedValueOnce('VERIFIED')
    mockPeerly.createCampaignVerifyToken.mockResolvedValueOnce('cv-token')

    await withEnv('prod', async () => {
      const token = await service.retrieveCampaignVerifyToken(
        'any-pin',
        tcrWithIdentity,
      )

      expect(token).toBe('cv-token')
      expect(mockPeerly.verifyCampaignVerifyPin).not.toHaveBeenCalled()
      expect(mockPeerly.createCampaignVerifyToken).toHaveBeenCalledWith(
        'peerly-1',
        { id: 1 },
      )
    })
  })
})

describe('CampaignTcrComplianceService - resendCampaignVerifyPin', () => {
  let service: CampaignTcrComplianceService
  let mockPeerly: {
    retrieveCampaignVerifyDetails: ReturnType<typeof vi.fn>
    resendCampaignVerifyPin: ReturnType<typeof vi.fn>
  }
  let mockModel: { findUnique: ReturnType<typeof vi.fn> }
  let mockAnalytics: { track: ReturnType<typeof vi.fn> }

  const campaign = createMockCampaign({ id: 7, userId: 1 })

  const withEnv = async (
    value: string | undefined,
    body: () => Promise<void>,
  ) => {
    const original = process.env.OTEL_SERVICE_ENVIRONMENT
    if (value === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = value
    try {
      await body()
    } finally {
      if (original === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
      else process.env.OTEL_SERVICE_ENVIRONMENT = original
    }
  }

  beforeEach(async () => {
    mockPeerly = {
      retrieveCampaignVerifyDetails: vi.fn(),
      resendCampaignVerifyPin: vi.fn().mockResolvedValue(undefined),
    }
    mockModel = { findUnique: vi.fn() }
    mockAnalytics = { track: vi.fn().mockResolvedValue(undefined) }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: { tcrCompliance: mockModel } },
        { provide: PeerlyIdentityService, useValue: mockPeerly },
        { provide: WebsitesService, useValue: {} },
        { provide: CampaignsService, useValue: {} },
        { provide: CrmCampaignsService, useValue: {} },
        { provide: ComplianceStateService, useValue: {} },
        { provide: QueueProducerService, useValue: {} },
        { provide: ExperimentRunsService, useValue: {} },
        { provide: PinoLogger, useValue: createMockLogger() },
        { provide: AnalyticsService, useValue: mockAnalytics },
        {
          provide: SlackService,
          useValue: { errorMessage: vi.fn().mockResolvedValue('ok') },
        },
        CampaignTcrComplianceService,
      ],
    }).compile()
    service = module.get(CampaignTcrComplianceService)
  })

  it('throws NotFoundException when the campaign has no TCR record', async () => {
    mockModel.findUnique.mockResolvedValueOnce(null)

    await withEnv('prod', async () => {
      await expect(service.resendCampaignVerifyPin(campaign)).rejects.toThrow(
        NotFoundException,
      )
      expect(mockPeerly.resendCampaignVerifyPin).not.toHaveBeenCalled()
    })
  })

  it('short-circuits in non-prod without touching Peerly', async () => {
    mockModel.findUnique.mockResolvedValueOnce({
      id: 'tcr-1',
      peerlyIdentityId: null,
    })

    await withEnv('dev', async () => {
      await expect(
        service.resendCampaignVerifyPin(campaign),
      ).resolves.toBeUndefined()
      expect(mockPeerly.retrieveCampaignVerifyDetails).not.toHaveBeenCalled()
      expect(mockPeerly.resendCampaignVerifyPin).not.toHaveBeenCalled()
      expect(mockAnalytics.track).toHaveBeenCalledWith(
        campaign.userId,
        EVENTS.Outreach.CompliancePinResent,
        { triggered_by: 'admin' },
      )
    })
  })

  it('throws UnprocessableEntityException when no Peerly identity exists yet', async () => {
    mockModel.findUnique.mockResolvedValueOnce({
      id: 'tcr-1',
      peerlyIdentityId: null,
    })

    await withEnv('prod', async () => {
      await expect(service.resendCampaignVerifyPin(campaign)).rejects.toThrow(
        UnprocessableEntityException,
      )
      expect(mockPeerly.retrieveCampaignVerifyDetails).not.toHaveBeenCalled()
      expect(mockPeerly.resendCampaignVerifyPin).not.toHaveBeenCalled()
    })
  })

  it('throws ConflictException when the PIN was already verified', async () => {
    mockModel.findUnique.mockResolvedValueOnce({
      id: 'tcr-1',
      peerlyIdentityId: 'peerly-1',
    })
    mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce({
      status: PeerlyCvVerificationStatus.VERIFIED,
      pinDelivery: null,
    })

    await withEnv('prod', async () => {
      await expect(service.resendCampaignVerifyPin(campaign)).rejects.toThrow(
        ConflictException,
      )
      expect(mockPeerly.resendCampaignVerifyPin).not.toHaveBeenCalled()
      expect(mockAnalytics.track).not.toHaveBeenCalled()
    })
  })

  it('throws UnprocessableEntityException when CV has not issued a PIN yet', async () => {
    mockModel.findUnique.mockResolvedValueOnce({
      id: 'tcr-1',
      peerlyIdentityId: 'peerly-1',
    })
    mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce({
      status: PeerlyCvVerificationStatus.REQUESTED,
      pinDelivery: null,
    })

    await withEnv('prod', async () => {
      await expect(service.resendCampaignVerifyPin(campaign)).rejects.toThrow(
        UnprocessableEntityException,
      )
      expect(mockPeerly.resendCampaignVerifyPin).not.toHaveBeenCalled()
    })
  })

  it('throws UnprocessableEntityException when Peerly has no CV request (404-as-null)', async () => {
    mockModel.findUnique.mockResolvedValueOnce({
      id: 'tcr-1',
      peerlyIdentityId: 'peerly-1',
    })
    mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce({
      status: null,
      pinDelivery: null,
    })

    await withEnv('prod', async () => {
      await expect(service.resendCampaignVerifyPin(campaign)).rejects.toThrow(
        UnprocessableEntityException,
      )
      expect(mockPeerly.resendCampaignVerifyPin).not.toHaveBeenCalled()
    })
  })

  it('resends the PIN when the live CV status is APPROVED', async () => {
    mockModel.findUnique.mockResolvedValueOnce({
      id: 'tcr-1',
      peerlyIdentityId: 'peerly-1',
    })
    mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce({
      status: PeerlyCvVerificationStatus.APPROVED,
      pinDelivery: null,
    })

    await withEnv('prod', async () => {
      await expect(
        service.resendCampaignVerifyPin(campaign),
      ).resolves.toBeUndefined()
      expect(mockPeerly.resendCampaignVerifyPin).toHaveBeenCalledWith(
        'peerly-1',
        campaign,
      )
      expect(mockAnalytics.track).toHaveBeenCalledWith(
        campaign.userId,
        EVENTS.Outreach.CompliancePinResent,
        { triggered_by: 'admin', peerly_identity_id: 'peerly-1' },
      )
    })
  })

  it('does not fire the resent event when the Peerly resend call fails', async () => {
    mockModel.findUnique.mockResolvedValueOnce({
      id: 'tcr-1',
      peerlyIdentityId: 'peerly-1',
    })
    mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce({
      status: PeerlyCvVerificationStatus.APPROVED,
      pinDelivery: null,
    })
    mockPeerly.resendCampaignVerifyPin.mockRejectedValueOnce(
      new BadGatewayException('Peerly API error'),
    )

    await withEnv('prod', async () => {
      await expect(service.resendCampaignVerifyPin(campaign)).rejects.toThrow(
        BadGatewayException,
      )
      expect(mockAnalytics.track).not.toHaveBeenCalled()
    })
  })

  it('propagates a Peerly failure from the resend call', async () => {
    mockModel.findUnique.mockResolvedValueOnce({
      id: 'tcr-1',
      peerlyIdentityId: 'peerly-1',
    })
    mockPeerly.retrieveCampaignVerifyDetails.mockResolvedValueOnce({
      status: PeerlyCvVerificationStatus.APPROVED,
      pinDelivery: null,
    })
    mockPeerly.resendCampaignVerifyPin.mockRejectedValueOnce(
      new BadGatewayException('Peerly API error'),
    )

    await withEnv('prod', async () => {
      await expect(service.resendCampaignVerifyPin(campaign)).rejects.toThrow(
        BadGatewayException,
      )
    })
  })
})

describe('CampaignTcrComplianceService - sweepUnsubmittedUsecases', () => {
  let service: CampaignTcrComplianceService
  let mockPeerly: {
    getIdentityProfile: ReturnType<typeof vi.fn>
    retrieveCampaignVerifyStatus: ReturnType<typeof vi.fn>
    createCampaignVerifyToken: ReturnType<typeof vi.fn>
    submitCampaignVerifyTokenToBrand: ReturnType<typeof vi.fn>
  }
  let mockCampaigns: { findUnique: ReturnType<typeof vi.fn> }
  let mockModel: {
    findMany: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  let mockPrisma: { tcrCompliance: typeof mockModel }

  const campaign = createMockCampaign({ id: 555 })
  const stuckRecord = {
    id: 'tcr-stuck',
    campaignId: campaign.id,
    peerlyIdentityId: 'peerly-stuck',
    committeeName: 'Stuck Committee',
    status: TcrComplianceStatus.submitted,
  }

  const submitUsecaseIfVerified = (
    svc: CampaignTcrComplianceService,
    rec: unknown,
  ) =>
    (
      svc as unknown as {
        submitUsecaseIfVerified: (r: unknown) => Promise<void>
      }
    ).submitUsecaseIfVerified(rec)

  const sweep = (svc: CampaignTcrComplianceService) =>
    (
      svc as unknown as { sweepUnsubmittedUsecases: () => Promise<void> }
    ).sweepUnsubmittedUsecases()

  const withEnv = async (value: string, body: () => Promise<void>) => {
    const original = process.env.OTEL_SERVICE_ENVIRONMENT
    process.env.OTEL_SERVICE_ENVIRONMENT = value
    try {
      await body()
    } finally {
      if (original === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
      else process.env.OTEL_SERVICE_ENVIRONMENT = original
    }
  }

  beforeEach(async () => {
    mockPeerly = {
      getIdentityProfile: vi
        .fn()
        .mockResolvedValue({ profile: { status: 'pending' } }),
      retrieveCampaignVerifyStatus: vi.fn().mockResolvedValue('VERIFIED'),
      createCampaignVerifyToken: vi.fn().mockResolvedValue('cv-token-1'),
      submitCampaignVerifyTokenToBrand: vi
        .fn()
        .mockResolvedValue({ brand: 'ok' }),
    }
    mockCampaigns = { findUnique: vi.fn().mockResolvedValue(campaign) }
    mockModel = {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
    }
    mockPrisma = { tcrCompliance: mockModel }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PeerlyIdentityService, useValue: mockPeerly },
        { provide: WebsitesService, useValue: {} },
        { provide: CampaignsService, useValue: mockCampaigns },
        { provide: CrmCampaignsService, useValue: {} },
        { provide: ComplianceStateService, useValue: {} },
        { provide: QueueProducerService, useValue: { sendMessage: vi.fn() } },
        {
          provide: ExperimentRunsService,
          useValue: { findFirst: vi.fn(), dispatchRun: vi.fn() },
        },
        { provide: PinoLogger, useValue: createMockLogger() },
        {
          provide: AnalyticsService,
          useValue: { track: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: SlackService,
          useValue: { errorMessage: vi.fn().mockResolvedValue('ok') },
        },
        CampaignTcrComplianceService,
      ],
    }).compile()

    service = module.get(CampaignTcrComplianceService)
  })

  it('mints a token and submits the usecase when CV is VERIFIED', async () => {
    mockPeerly.retrieveCampaignVerifyStatus.mockResolvedValueOnce('VERIFIED')

    await withEnv('prod', async () => {
      await submitUsecaseIfVerified(service, stuckRecord)
    })

    expect(mockPeerly.createCampaignVerifyToken).toHaveBeenCalledWith(
      'peerly-stuck',
      campaign,
    )
    expect(mockPeerly.submitCampaignVerifyTokenToBrand).toHaveBeenCalledWith(
      stuckRecord,
      'cv-token-1',
    )
    expect(mockModel.update).toHaveBeenCalledWith({
      where: { id: 'tcr-stuck' },
      data: { status: TcrComplianceStatus.pending },
    })
  })

  it('does not submit or advance when CV is APPROVED (candidate still owes a PIN)', async () => {
    // APPROVED can be reached by the CV authority before the candidate enters
    // their PIN, so the sweep must leave the record in `submitted`. Advancing
    // it to `pending` would flip the candidate to the "in review" screen and
    // strand them with a PIN they can no longer enter.
    mockPeerly.retrieveCampaignVerifyStatus.mockResolvedValueOnce('APPROVED')

    await withEnv('prod', async () => {
      await submitUsecaseIfVerified(service, stuckRecord)
    })

    expect(mockPeerly.createCampaignVerifyToken).not.toHaveBeenCalled()
    expect(mockPeerly.submitCampaignVerifyTokenToBrand).not.toHaveBeenCalled()
    expect(mockModel.update).not.toHaveBeenCalled()
  })

  it.each(['waiting_to_finalize', 'finalized'])(
    'skips when the profile is already past pending (status %s)',
    async (status) => {
      mockPeerly.getIdentityProfile.mockResolvedValueOnce({
        profile: { status },
      })

      await submitUsecaseIfVerified(service, stuckRecord)

      expect(mockPeerly.retrieveCampaignVerifyStatus).not.toHaveBeenCalled()
      expect(mockPeerly.createCampaignVerifyToken).not.toHaveBeenCalled()
      expect(mockModel.update).not.toHaveBeenCalled()
    },
  )

  it.each(['REQUESTED', 'IN_REVIEW', 'REJECTED', 'WITHDRAWN'])(
    'skips (no token, no Slack-spamming approve) when CV is %s',
    async (status) => {
      mockPeerly.retrieveCampaignVerifyStatus.mockResolvedValueOnce(status)

      await submitUsecaseIfVerified(service, stuckRecord)

      expect(mockPeerly.createCampaignVerifyToken).not.toHaveBeenCalled()
      expect(mockPeerly.submitCampaignVerifyTokenToBrand).not.toHaveBeenCalled()
      expect(mockModel.update).not.toHaveBeenCalled()
    },
  )

  it('marks the record error and rethrows when approve fails (sweep stops re-alerting)', async () => {
    const approveErr = new Error('Peerly approve rejected')
    mockPeerly.submitCampaignVerifyTokenToBrand.mockRejectedValueOnce(
      approveErr,
    )

    await withEnv('prod', async () => {
      await expect(submitUsecaseIfVerified(service, stuckRecord)).rejects.toBe(
        approveErr,
      )
    })

    expect(mockModel.update).toHaveBeenCalledWith({
      where: { id: 'tcr-stuck' },
      data: { status: TcrComplianceStatus.error },
    })
    expect(mockModel.update).not.toHaveBeenCalledWith({
      where: { id: 'tcr-stuck' },
      data: { status: TcrComplianceStatus.pending },
    })
  })

  it('does not advance status in non-prod (no real usecase submission)', async () => {
    // submitCampaignVerifyToken short-circuits to undefined off-prod; the record
    // must not be promoted to pending for a usecase that was never submitted.
    await withEnv('dev', async () => {
      await submitUsecaseIfVerified(service, stuckRecord)
    })

    expect(mockPeerly.submitCampaignVerifyTokenToBrand).not.toHaveBeenCalled()
    expect(mockModel.update).not.toHaveBeenCalled()
  })

  it('skips when CV status is null (no CV request exists for the identity)', async () => {
    mockPeerly.retrieveCampaignVerifyStatus.mockResolvedValueOnce(null)

    await submitUsecaseIfVerified(service, stuckRecord)

    expect(mockPeerly.createCampaignVerifyToken).not.toHaveBeenCalled()
    expect(mockPeerly.submitCampaignVerifyTokenToBrand).not.toHaveBeenCalled()
    expect(mockModel.update).not.toHaveBeenCalled()
  })

  it('skips (no rethrow) when the Peerly identity 404s (orphaned/deleted)', async () => {
    mockPeerly.getIdentityProfile.mockRejectedValueOnce(
      new NotFoundException('identity not found'),
    )

    await expect(
      submitUsecaseIfVerified(service, stuckRecord),
    ).resolves.toBeUndefined()

    expect(mockPeerly.retrieveCampaignVerifyStatus).not.toHaveBeenCalled()
    expect(mockModel.update).not.toHaveBeenCalled()
  })

  it('does nothing when the record has no Peerly identity', async () => {
    await submitUsecaseIfVerified(service, {
      ...stuckRecord,
      peerlyIdentityId: null,
    })

    expect(mockCampaigns.findUnique).not.toHaveBeenCalled()
    expect(mockPeerly.getIdentityProfile).not.toHaveBeenCalled()
  })

  it('does not advance status when no CV token could be minted', async () => {
    mockPeerly.createCampaignVerifyToken.mockResolvedValueOnce(undefined)

    await withEnv('prod', async () => {
      await submitUsecaseIfVerified(service, stuckRecord)
    })

    expect(mockPeerly.submitCampaignVerifyTokenToBrand).not.toHaveBeenCalled()
    expect(mockModel.update).not.toHaveBeenCalled()
  })

  it('sweeps submitted records that have a Peerly identity', async () => {
    mockModel.findMany.mockResolvedValueOnce([])

    await sweep(service)

    expect(mockModel.findMany).toHaveBeenCalledWith({
      where: {
        status: TcrComplianceStatus.submitted,
        peerlyIdentityId: { not: null },
      },
    })
  })

  it('continues after one record throws', async () => {
    const a = { ...stuckRecord, id: 'tcr-a', campaignId: 1 }
    const b = { ...stuckRecord, id: 'tcr-b', campaignId: 2 }
    mockModel.findMany.mockResolvedValueOnce([a, b])
    mockPeerly.getIdentityProfile
      .mockRejectedValueOnce(new Error('Peerly down'))
      .mockResolvedValueOnce({ profile: { status: 'pending' } })

    await withEnv('prod', async () => {
      await sweep(service)
    })

    expect(mockPeerly.getIdentityProfile).toHaveBeenCalledTimes(2)
    // The second record still gets its usecase submitted.
    expect(mockModel.update).toHaveBeenCalledWith({
      where: { id: 'tcr-b' },
      data: { status: TcrComplianceStatus.pending },
    })
  })
})
