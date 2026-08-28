import { Test, TestingModule } from '@nestjs/testing'
import { HttpStatus, NotFoundException } from '@nestjs/common'
import { HTTP_CODE_METADATA } from '@nestjs/common/constants'
import { CommitteeType, TcrComplianceStatus } from '../../generated/prisma'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { CampaignTcrComplianceController } from './campaignTcrCompliance.controller'
import { CampaignTcrComplianceService } from './services/campaignTcrCompliance.service'
import { ComplianceStateService } from './services/complianceState.service'
import { ComplianceStage } from '@goodparty_org/contracts'
import { UsersService } from '../../users/services/users.service'
import { CampaignsService } from '../services/campaigns.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import {
  createMockUser,
  createMockCampaign,
} from '@/shared/test-utils/mockData.util'
import { ClerkUserEnricherService } from '@/vendors/clerk/services/clerk-user-enricher.service'
import { createMockClerkEnricher } from '@/shared/test-utils/mockClerkEnricher.util'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'

function getGuards(methodName: keyof CampaignTcrComplianceController) {
  return (
    Reflect.getMetadata(
      '__guards__',
      CampaignTcrComplianceController.prototype[methodName],
    ) ?? []
  )
}

const mockUser = createMockUser()
const mockCampaign = createMockCampaign({ userId: mockUser.id })

const mockTcrCompliance = {
  id: 'tcr-123',
  campaignId: 1,
  peerlyIdentityId: 'peerly-123',
  status: TcrComplianceStatus.submitted,
}

describe('CampaignTcrComplianceController', () => {
  let controller: CampaignTcrComplianceController
  let mockAnalytics: { track: ReturnType<typeof vi.fn> }
  let mockTcrService: {
    fetchByCampaignId: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    createAgentic: ReturnType<typeof vi.fn>
    submitToPeerlyForAgent: ReturnType<typeof vi.fn>
    retrieveCampaignVerifyToken: ReturnType<typeof vi.fn>
    submitCampaignVerifyToken: ReturnType<typeof vi.fn>
    resendCampaignVerifyPin: ReturnType<typeof vi.fn>
    grantInternalTestingApproval: ReturnType<typeof vi.fn>
    revokeInternalTestingApproval: ReturnType<typeof vi.fn>
    model: { update: ReturnType<typeof vi.fn> }
  }
  let mockUserService: { findByCampaign: ReturnType<typeof vi.fn> }
  let mockCampaignsService: {
    updateJsonFields: ReturnType<typeof vi.fn>
    findUniqueOrThrow: ReturnType<typeof vi.fn>
  }
  let mockComplianceStateService: {
    findStateForCampaign: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    mockAnalytics = {
      track: vi.fn().mockResolvedValue(undefined),
    }

    mockTcrService = {
      fetchByCampaignId: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(mockTcrCompliance),
      createAgentic: vi
        .fn()
        .mockResolvedValue({ record: mockTcrCompliance, created: true }),
      submitToPeerlyForAgent: vi.fn(),
      retrieveCampaignVerifyToken: vi.fn().mockResolvedValue('cv-token-123'),
      submitCampaignVerifyToken: vi.fn().mockResolvedValue({ brand: 'ok' }),
      resendCampaignVerifyPin: vi.fn().mockResolvedValue(undefined),
      grantInternalTestingApproval: vi
        .fn()
        .mockResolvedValue(mockTcrCompliance),
      revokeInternalTestingApproval: vi.fn().mockResolvedValue(undefined),
      model: { update: vi.fn().mockResolvedValue(mockTcrCompliance) },
    }

    mockUserService = {
      findByCampaign: vi.fn().mockResolvedValue(mockUser),
    }

    mockCampaignsService = {
      updateJsonFields: vi.fn().mockResolvedValue(mockCampaign),
      findUniqueOrThrow: vi.fn().mockResolvedValue(mockCampaign),
    }

    mockComplianceStateService = {
      findStateForCampaign: vi.fn().mockResolvedValue({
        stage: ComplianceStage.awaiting_pin,
        domain: null,
        websiteId: null,
        peerlyVerificationId: null,
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: UsersService, useValue: mockUserService },
        {
          provide: CampaignTcrComplianceService,
          useValue: mockTcrService,
        },
        {
          provide: ComplianceStateService,
          useValue: mockComplianceStateService,
        },
        { provide: CampaignsService, useValue: mockCampaignsService },
        { provide: AnalyticsService, useValue: mockAnalytics },
        {
          provide: ClerkUserEnricherService,
          useValue: createMockClerkEnricher(),
        },
        { provide: PinoLogger, useValue: createMockLogger() },
        CampaignTcrComplianceController,
      ],
    }).compile()

    controller = module.get<CampaignTcrComplianceController>(
      CampaignTcrComplianceController,
    )

    vi.clearAllMocks()
  })

  describe('getMyTcrCompliance', () => {
    it('returns null when the campaign has no TCR record yet', async () => {
      mockTcrService.fetchByCampaignId.mockResolvedValue(null)

      const result = await controller.getMyTcrCompliance(mockCampaign)

      expect(result).toBeNull()
    })

    it('returns the TCR record when one exists', async () => {
      mockTcrService.fetchByCampaignId.mockResolvedValue(mockTcrCompliance)

      const result = await controller.getMyTcrCompliance(mockCampaign)

      expect(result).toEqual(mockTcrCompliance)
    })
  })

  describe('createTcrCompliance - Segment event tracking', () => {
    const tcrComplianceDto = {
      ein: '12-3456789',
      committeeName: 'Test Committee',
      candidateName: 'Jane Candidate',
      websiteDomain: 'example.com',
      filingUrl: 'https://fec.gov/filing',
      email: 'test@example.com',
      phone: '5555555555',
      officeLevel: 'federal' as const,
      fecCommitteeId: 'C00123456',
      committeeType: CommitteeType.HOUSE,
      placeId: 'place-123',
      formattedAddress: '123 Main St',
    }

    it('should track ComplianceFormSubmitted event after successful creation', async () => {
      await controller.createTcrCompliance(mockCampaign, tcrComplianceDto)

      expect(mockAnalytics.track).toHaveBeenCalledWith(
        mockUser.id,
        EVENTS.Outreach.ComplianceFormSubmitted,
        { source: 'compliance_flow' },
      )
    })

    it('should not track event when compliance already exists', async () => {
      mockTcrService.fetchByCampaignId.mockResolvedValue(mockTcrCompliance)

      await expect(
        controller.createTcrCompliance(mockCampaign, tcrComplianceDto),
      ).rejects.toThrow()

      expect(mockAnalytics.track).not.toHaveBeenCalled()
    })

    it('should still return the result when analytics tracking fails', async () => {
      mockAnalytics.track.mockRejectedValue(new Error('Segment unavailable'))

      const result = await controller.createTcrCompliance(
        mockCampaign,
        tcrComplianceDto,
      )

      expect(result).toEqual(mockTcrCompliance)
    })
  })

  describe('createAgenticTcrCompliance', () => {
    const agenticDto = {
      ein: '12-3456789',
      committeeName: 'Test Committee',
      candidateName: 'Jane Candidate',
      filingUrl: 'https://example.com/filing',
      email: 'test@example.com',
      phone: '5555555555',
      officeLevel: 'state' as const,
      committeeType: CommitteeType.CANDIDATE,
      placeId: 'place-123',
      formattedAddress: '123 Main St',
    }

    it('delegates to service.createAgentic and returns the record', async () => {
      const result = await controller.createAgenticTcrCompliance(
        mockCampaign,
        agenticDto,
      )

      expect(mockTcrService.createAgentic).toHaveBeenCalledTimes(1)
      expect(mockTcrService.createAgentic).toHaveBeenCalledWith(
        mockUser,
        mockCampaign,
        expect.objectContaining({
          ein: agenticDto.ein,
          committeeName: agenticDto.committeeName,
        }),
      )
      expect(result).toEqual(mockTcrCompliance)
    })

    it('accepts a payload with no websiteDomain', async () => {
      await controller.createAgenticTcrCompliance(mockCampaign, agenticDto)

      const payload = firstOrThrow(mockTcrService.createAgentic.mock.calls)[2]
      expect(payload.websiteDomain).toBeUndefined()
    })

    it('returns the existing record when the service short-circuits idempotently', async () => {
      const existing = { ...mockTcrCompliance, id: 'tcr-existing' }
      mockTcrService.createAgentic.mockResolvedValue({
        record: existing,
        created: false,
      })

      const result = await controller.createAgenticTcrCompliance(
        mockCampaign,
        agenticDto,
      )

      expect(result).toEqual(existing)
      expect(mockTcrService.createAgentic).toHaveBeenCalledTimes(1)
    })

    it('tracks ComplianceFormSubmitted with the agentic source when a new record is created', async () => {
      await controller.createAgenticTcrCompliance(mockCampaign, agenticDto)

      expect(mockAnalytics.track).toHaveBeenCalledWith(
        mockUser.id,
        EVENTS.Outreach.ComplianceFormSubmitted,
        { source: 'agentic_compliance_flow' },
      )
    })

    it('does NOT track analytics on idempotent re-call (existing record returned)', async () => {
      mockTcrService.createAgentic.mockResolvedValue({
        record: mockTcrCompliance,
        created: false,
      })

      await controller.createAgenticTcrCompliance(mockCampaign, agenticDto)

      expect(mockAnalytics.track).not.toHaveBeenCalled()
    })

    it('still returns the result when analytics tracking fails', async () => {
      mockAnalytics.track.mockRejectedValue(new Error('Segment unavailable'))

      const result = await controller.createAgenticTcrCompliance(
        mockCampaign,
        agenticDto,
      )

      expect(result).toEqual(mockTcrCompliance)
    })

    it('responds with HTTP 202 Accepted', () => {
      const httpCode = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        controller.createAgenticTcrCompliance,
      )
      expect(httpCode).toBe(HttpStatus.ACCEPTED)
    })

    it('throws NotFoundException when the campaign has no user', async () => {
      mockUserService.findByCampaign.mockResolvedValue(null)

      await expect(
        controller.createAgenticTcrCompliance(mockCampaign, agenticDto),
      ).rejects.toThrow(NotFoundException)
      expect(mockTcrService.createAgentic).not.toHaveBeenCalled()
      expect(mockAnalytics.track).not.toHaveBeenCalled()
    })
  })

  describe('submitCampaignVerifyPIN - Segment event tracking', () => {
    beforeEach(() => {
      mockTcrService.fetchByCampaignId.mockResolvedValue(mockTcrCompliance)
    })

    it('should track CompliancePinSubmitted event after successful PIN submission', async () => {
      await controller.submitCampaignVerifyPIN(
        mockTcrCompliance.id,
        { pin: '123456' },
        mockUser,
        mockCampaign,
      )

      expect(mockAnalytics.track).toHaveBeenCalledWith(
        mockUser.id,
        EVENTS.Outreach.CompliancePinSubmitted,
        { source: 'compliance_flow' },
      )
    })

    it('should not track event when token retrieval fails', async () => {
      mockTcrService.retrieveCampaignVerifyToken.mockRejectedValue(
        new Error('Invalid PIN'),
      )

      await expect(
        controller.submitCampaignVerifyPIN(
          mockTcrCompliance.id,
          { pin: '000000' },
          mockUser,
          mockCampaign,
        ),
      ).rejects.toThrow()

      expect(mockAnalytics.track).not.toHaveBeenCalled()
    })

    it('should not track event when token is null', async () => {
      mockTcrService.retrieveCampaignVerifyToken.mockResolvedValue(null)

      await expect(
        controller.submitCampaignVerifyPIN(
          mockTcrCompliance.id,
          { pin: '123456' },
          mockUser,
          mockCampaign,
        ),
      ).rejects.toThrow()

      expect(mockAnalytics.track).not.toHaveBeenCalled()
    })

    it('should still return the result when analytics tracking fails', async () => {
      const expectedBrand = { brand: 'ok' }
      mockTcrService.submitCampaignVerifyToken.mockResolvedValue(expectedBrand)
      mockAnalytics.track.mockRejectedValue(new Error('Segment unavailable'))

      const result = await controller.submitCampaignVerifyPIN(
        mockTcrCompliance.id,
        { pin: '123456' },
        mockUser,
        mockCampaign,
      )

      expect(result).toEqual(expectedBrand)
    })
  })

  describe('submitToPeerly', () => {
    it('delegates to service.submitToPeerlyForAgent and returns its output', async () => {
      const expectedOutput = {
        tcrComplianceId: 'tcr-1',
        peerlyIdentityId: 'peerly-id-1',
        peerlyIdentityProfileLink: 'https://peerly/profile/1',
        peerly10DLCBrandSubmissionKey: 'brand-key-1',
        peerlyVerificationId: 'cv-verif-1',
        stage: ComplianceStage.awaiting_pin,
        pinDeliveryChannels: {
          email: 'test@example.com',
          phone: '5555555555',
        },
      }
      mockTcrService.submitToPeerlyForAgent = vi
        .fn()
        .mockResolvedValue(expectedOutput)

      const result = await controller.submitToPeerly(mockCampaign)

      // No request body: the route sources every Peerly field from the
      // persisted record, so it delegates with just the user + campaign.
      expect(mockTcrService.submitToPeerlyForAgent).toHaveBeenCalledWith(
        mockUser,
        mockCampaign,
      )
      expect(result).toEqual(expectedOutput)
    })

    it('throws NotFoundException when the campaign has no user', async () => {
      mockUserService.findByCampaign.mockResolvedValue(null)
      mockTcrService.submitToPeerlyForAgent = vi.fn()

      await expect(controller.submitToPeerly(mockCampaign)).rejects.toThrow(
        'User not found for this campaign',
      )

      expect(mockTcrService.submitToPeerlyForAgent).not.toHaveBeenCalled()
    })
  })

  describe('getMyComplianceState', () => {
    it('delegates to ComplianceStateService with the campaign id', async () => {
      const expectedState = {
        stage: ComplianceStage.pending_website_live,
        domain: {
          name: 'example.org',
          status: 'registered' as const,
          registrantVerifiedAt: null,
        },
        websiteId: 42,
        peerlyVerificationId: null,
      }
      mockComplianceStateService.findStateForCampaign.mockResolvedValue(
        expectedState,
      )

      const result = await controller.getMyComplianceState(mockCampaign)

      expect(
        mockComplianceStateService.findStateForCampaign,
      ).toHaveBeenCalledWith(mockCampaign.id)
      expect(result).toEqual(expectedState)
    })
  })

  describe('getComplianceStateForCampaign (admin)', () => {
    it('is gated by AdminOrM2MGuard', () => {
      expect(
        getGuards('getComplianceStateForCampaign').map(
          (g: { name: string }) => g.name,
        ),
      ).toContain(AdminOrM2MGuard.name)
    })

    it('delegates to ComplianceStateService with the campaignId param', async () => {
      const expectedState = {
        stage: ComplianceStage.awaiting_pin,
        domain: null,
        websiteId: null,
        peerlyVerificationId: null,
      }
      mockComplianceStateService.findStateForCampaign.mockResolvedValue(
        expectedState,
      )

      const result = await controller.getComplianceStateForCampaign(99)

      expect(
        mockComplianceStateService.findStateForCampaign,
      ).toHaveBeenCalledWith(99)
      expect(result).toEqual(expectedState)
    })
  })

  describe('resendCampaignVerifyPinForCampaign (admin)', () => {
    it('is gated by AdminOrM2MGuard', () => {
      expect(
        getGuards('resendCampaignVerifyPinForCampaign').map(
          (g: { name: string }) => g.name,
        ),
      ).toContain(AdminOrM2MGuard.name)
    })

    it('responds with HTTP 204 No Content', () => {
      const statusCode = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        CampaignTcrComplianceController.prototype
          .resendCampaignVerifyPinForCampaign,
      )
      expect(statusCode).toBe(HttpStatus.NO_CONTENT)
    })

    it('loads the campaign and delegates the resend to the service', async () => {
      mockCampaignsService.findUniqueOrThrow.mockResolvedValue(mockCampaign)

      await controller.resendCampaignVerifyPinForCampaign(mockCampaign.id)

      expect(mockCampaignsService.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: mockCampaign.id },
      })
      expect(mockTcrService.resendCampaignVerifyPin).toHaveBeenCalledWith(
        mockCampaign,
      )
    })

    it('does not resend when the campaign does not exist', async () => {
      mockCampaignsService.findUniqueOrThrow.mockRejectedValue(
        new NotFoundException(),
      )

      await expect(
        controller.resendCampaignVerifyPinForCampaign(12345),
      ).rejects.toThrow(NotFoundException)
      expect(mockTcrService.resendCampaignVerifyPin).not.toHaveBeenCalled()
    })
  })

  describe('grantInternalTestingApproval (admin)', () => {
    it('is gated by AdminOrM2MGuard', () => {
      expect(
        getGuards('grantInternalTestingApproval').map(
          (g: { name: string }) => g.name,
        ),
      ).toContain(AdminOrM2MGuard.name)
    })

    it('responds with HTTP 204 No Content', () => {
      const statusCode = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        CampaignTcrComplianceController.prototype.grantInternalTestingApproval,
      )
      expect(statusCode).toBe(HttpStatus.NO_CONTENT)
    })

    it('loads the campaign owner and delegates the grant to the service', async () => {
      mockCampaignsService.findUniqueOrThrow.mockResolvedValue(mockCampaign)

      await controller.grantInternalTestingApproval(mockCampaign.id)

      expect(mockUserService.findByCampaign).toHaveBeenCalledWith(mockCampaign)
      expect(mockTcrService.grantInternalTestingApproval).toHaveBeenCalledWith(
        mockUser,
        mockCampaign,
      )
    })

    it('throws NotFoundException when the campaign has no user', async () => {
      mockUserService.findByCampaign.mockResolvedValue(null)

      await expect(
        controller.grantInternalTestingApproval(mockCampaign.id),
      ).rejects.toThrow(NotFoundException)
      expect(mockTcrService.grantInternalTestingApproval).not.toHaveBeenCalled()
    })
  })

  describe('revokeInternalTestingApproval (admin)', () => {
    it('is gated by AdminOrM2MGuard', () => {
      expect(
        getGuards('revokeInternalTestingApproval').map(
          (g: { name: string }) => g.name,
        ),
      ).toContain(AdminOrM2MGuard.name)
    })

    it('responds with HTTP 204 No Content', () => {
      const statusCode = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        CampaignTcrComplianceController.prototype.revokeInternalTestingApproval,
      )
      expect(statusCode).toBe(HttpStatus.NO_CONTENT)
    })

    it('verifies the campaign exists and delegates the revoke', async () => {
      mockCampaignsService.findUniqueOrThrow.mockResolvedValue(mockCampaign)

      await controller.revokeInternalTestingApproval(mockCampaign.id)

      expect(mockCampaignsService.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: mockCampaign.id },
      })
      expect(mockTcrService.revokeInternalTestingApproval).toHaveBeenCalledWith(
        mockCampaign.id,
      )
    })

    it('does not revoke when the campaign does not exist', async () => {
      mockCampaignsService.findUniqueOrThrow.mockRejectedValue(
        new NotFoundException(),
      )

      await expect(
        controller.revokeInternalTestingApproval(12345),
      ).rejects.toThrow(NotFoundException)
      expect(
        mockTcrService.revokeInternalTestingApproval,
      ).not.toHaveBeenCalled()
    })
  })
})
