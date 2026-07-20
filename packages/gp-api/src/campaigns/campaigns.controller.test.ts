import { OrganizationsService } from '@/organizations/services/organizations.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CampaignStatus } from '@goodparty_org/contracts'
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { Campaign, Organization, User, UserRole } from '../generated/prisma'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CampaignsController } from './campaigns.controller'
import { CreateCampaignSchema } from './schemas/updateCampaign.schema'
import { CampaignPlanVersionsService } from './services/campaignPlanVersions.service'
import { CampaignsService } from './services/campaigns.service'
import { EligibilityService } from './services/eligibility.service'
import { FilingInstructionsService } from './filingInstructions/filingInstructions.service'
import { CampaignWith } from './campaigns.types'

const CREATED_AT = '2025-01-01'

// Shared null-filled defaults for the fields RaceTargetMetrics gained when
// fetchLiveRaceTargetMetrics started consuming /campaign-strategy-context.
// Tests that don't care about these can spread this into their fixture.
const EMPTY_RACE_CONTEXT_FIELDS = {
  filingOfficeAddress: null,
  filingPhoneNumber: null,
  paperworkInstructions: null,
  registeredVoters: null,
  uniqueCellphones: null,
  uniqueLandlines: null,
  projectedVoterTurnout: null,
  candidates: [],
  generalElectionDate: null,
  primaryElectionDate: null,
  relevantElectionDate: null,
  officialOfficeName: null,
  officeLevel: null,
  officeType: null,
  numberOfSeats: null,
  milestones: null,
}

const userDefaults = {
  createdAt: new Date(CREATED_AT),
  updatedAt: new Date(CREATED_AT),
  firstName: 'Test',
  lastName: 'User',
  name: 'Test User',
  avatar: null,
  password: null,
  hasPassword: false,
  email: 'test@example.com',
  phone: '5555555555',
  zip: '12345',
  metaData: null,
  passwordResetToken: null,
  clerkId: null,
}

const mockUser: User = {
  ...userDefaults,
  id: 1,
  roles: [UserRole.candidate],
}

const mockAdminUser: User = {
  ...userDefaults,
  id: 2,
  roles: [UserRole.admin],
}

const mockSalesUser: User = {
  ...userDefaults,
  id: 3,
  roles: [UserRole.sales],
}

const campaignDefaults = {
  createdAt: new Date(CREATED_AT),
  updatedAt: new Date(CREATED_AT),
  isVerified: false,
  isPro: false,
  isDemo: false,
  didWin: null,
  primaryResult: null,
  dateVerified: null,
  tier: null,
  formattedAddress: null,
  placeId: null,
  campaignEmail: null,
  aiContent: {},
  vendorTsData: {},
  canDownloadFederal: false,
  completedTaskIds: [],
  hasFreeTextsOffer: false,
  freeTextsOfferRedeemedAt: null,
}

const mockCampaign: Campaign = {
  ...campaignDefaults,
  id: 100,
  organizationSlug: 'campaign-100',
  slug: 'john-doe',
  userId: 1,
  isActive: true,
  data: { name: 'Real Campaign' },
  details: {
    electionDate: '2025-11-04',
    state: 'CA',
  } as unknown as Campaign['details'],
}

const OVERRIDE_SLUG = 'other'

const mockOtherCampaign: Campaign = {
  ...mockCampaign,
  id: 200,
  slug: OVERRIDE_SLUG,
}

describe('CampaignsController', () => {
  let controller: CampaignsController
  let campaignsService: CampaignsService
  let planVersionsService: CampaignPlanVersionsService
  let slackService: SlackService
  let organizationsService: OrganizationsService
  let analyticsService: AnalyticsService
  let filingInstructionsService: FilingInstructionsService
  let eligibilityService: EligibilityService

  beforeEach(() => {
    const campaignsServiceMock: Partial<CampaignsService> = {
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      findByUserId: vi.fn(),
      listCampaigns: vi.fn(),
      getStatus: vi.fn(),
      createForUser: vi.fn(),
      updateJsonFields: vi.fn(),
      launch: vi.fn(),
      fetchLiveRaceTargetMetrics: vi.fn().mockResolvedValue(null),
      setIsPro: vi.fn(),
    }
    campaignsService = campaignsServiceMock as CampaignsService

    const planVersionsServiceMock: Partial<CampaignPlanVersionsService> = {
      findByCampaignId: vi.fn(),
    }
    planVersionsService = planVersionsServiceMock as CampaignPlanVersionsService

    const slackServiceMock: Partial<SlackService> = {
      errorMessage: vi.fn(),
    }
    slackService = slackServiceMock as SlackService

    const organizationsServiceMock: Partial<OrganizationsService> = {
      resolveOverrideDistrictId: vi.fn().mockResolvedValue(null),
      findUnique: vi
        .fn()
        .mockResolvedValue({ positionId: 'pos-1', customPositionName: null }),
      resolveBallotReadyPositionId: vi.fn().mockResolvedValue('br-pos-1'),
      resolvePositionContext: vi.fn().mockResolvedValue({
        ballotReadyPositionId: 'br-pos-1',
        positionName: 'Mayor',
      }),
    }
    organizationsService = organizationsServiceMock as OrganizationsService

    const analyticsServiceMock: Partial<AnalyticsService> = {
      identify: vi.fn(),
      group: vi.fn(),
    }
    analyticsService = analyticsServiceMock as AnalyticsService

    const filingInstructionsServiceMock: Partial<FilingInstructionsService> = {
      emailToCandidate: vi.fn(),
      getContent: vi.fn(),
    }
    filingInstructionsService =
      filingInstructionsServiceMock as FilingInstructionsService

    const eligibilityServiceMock: Partial<EligibilityService> = {
      evaluate: vi.fn(),
    }
    eligibilityService = eligibilityServiceMock as EligibilityService

    controller = new CampaignsController(
      campaignsService,
      planVersionsService,
      slackService,
      organizationsService,
      analyticsService,
      filingInstructionsService,
      eligibilityService,
      createMockLogger(),
    )
  })

  describe('list', () => {
    it('enriches each item with positionName resolved from its organization', async () => {
      const campaignWithOrg = {
        ...mockCampaign,
        organization: { customPositionName: null, positionId: 'pos-1' },
      }
      vi.spyOn(campaignsService, 'listCampaigns').mockResolvedValue({
        data: [campaignWithOrg],
        meta: { total: 1, offset: 0, limit: 100 },
      })

      const result = await controller.list({ userId: 1 })

      expect(campaignsService.listCampaigns).toHaveBeenCalledWith({
        userId: 1,
      })
      expect(organizationsService.resolvePositionContext).toHaveBeenCalledWith({
        customPositionName: null,
        positionId: 'pos-1',
      })
      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toMatchObject({
        id: mockCampaign.id,
        positionName: 'Mayor',
      })
      // The relation itself should be stripped from the response.
      expect(result.data[0]).not.toHaveProperty('organization')
      expect(result.meta).toEqual({ total: 1, offset: 0, limit: 100 })
    })

    it('returns null positionName when the org has no position info', async () => {
      vi.spyOn(
        organizationsService,
        'resolvePositionContext',
      ).mockResolvedValue({
        ballotReadyPositionId: null,
        positionName: null,
      })
      vi.spyOn(campaignsService, 'listCampaigns').mockResolvedValue({
        data: [
          {
            ...mockCampaign,
            organization: { customPositionName: null, positionId: null },
          },
        ],
        meta: { total: 1, offset: 0, limit: 100 },
      })

      const result = await controller.list({ userId: 1 })

      expect(organizationsService.resolvePositionContext).toHaveBeenCalledWith({
        customPositionName: null,
        positionId: null,
      })
      expect(result.data[0]).toMatchObject({ positionName: null })
    })

    it('returns empty data when no campaigns exist', async () => {
      vi.spyOn(campaignsService, 'listCampaigns').mockResolvedValue({
        data: [],
        meta: { total: 0, offset: 0, limit: 100 },
      })

      const result = await controller.list({ userId: 999 })

      expect(result.data).toEqual([])
      expect(result.meta.total).toBe(0)
    })
  })

  describe('findMine', () => {
    it('returns the campaign with positionName and raceTargetMetrics', async () => {
      const campaignWithRelations: CampaignWith<'organization'> = {
        ...mockCampaign,
        organization: {} as Organization,
      }

      const result = await controller.findMine(campaignWithRelations)

      expect(result).toEqual({
        ...campaignWithRelations,
        positionName: 'Mayor',
        raceTargetMetrics: null,
      })
    })

    it('includes live metrics in raceTargetMetrics', async () => {
      const liveMetrics = {
        projectedTurnout: 8000,
        winNumber: 4001,
        voterContactGoal: 20005,
        filingFee: null,
        filingRequirementsText: null,
        ...EMPTY_RACE_CONTEXT_FIELDS,
      }
      vi.spyOn(
        campaignsService,
        'fetchLiveRaceTargetMetrics',
      ).mockResolvedValue(liveMetrics)

      const campaignWithRelations: CampaignWith<'organization'> = {
        ...mockCampaign,
        organization: {} as Organization,
      }

      const result = await controller.findMine(campaignWithRelations)

      expect(result.raceTargetMetrics).toEqual(liveMetrics)
      expect(result.positionName).toBe('Mayor')
    })
  })

  describe('getUserCampaignStatus', () => {
    it('delegates to campaigns.getStatus', async () => {
      vi.spyOn(campaignsService, 'getStatus').mockResolvedValue({
        status: CampaignStatus.candidate,
        slug: mockCampaign.slug,
        isVerified: true,
      })

      const result = await controller.getUserCampaignStatus(mockCampaign)

      expect(campaignsService.getStatus).toHaveBeenCalledWith(mockCampaign)
      expect(result).toEqual({
        status: CampaignStatus.candidate,
        slug: mockCampaign.slug,
        isVerified: true,
      })
    })

    it('handles undefined campaign', async () => {
      vi.spyOn(campaignsService, 'getStatus').mockResolvedValue({
        status: false,
      })

      const result = await controller.getUserCampaignStatus(undefined)

      expect(campaignsService.getStatus).toHaveBeenCalledWith(undefined)
      expect(result).toEqual({ status: false })
    })
  })

  describe('emailFilingInstructions', () => {
    it('emails the candidate their filing instructions and returns success', async () => {
      const result = await controller.emailFilingInstructions(
        mockCampaign,
        mockUser,
      )

      expect(filingInstructionsService.emailToCandidate).toHaveBeenCalledWith(
        mockCampaign,
        mockUser,
      )
      expect(result).toEqual({ success: true })
    })
  })

  describe('testSetPro', () => {
    it('rejects a non-@test.goodparty.org user with ForbiddenException', async () => {
      const realUser = { ...mockUser, email: 'candidate@gmail.com' }

      await expect(
        controller.testSetPro(mockCampaign, realUser),
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(campaignsService.setIsPro).not.toHaveBeenCalled()
    })

    it('flips isPro for a @test.goodparty.org user on their own campaign', async () => {
      const testUser = { ...mockUser, email: 'test-42@test.goodparty.org' }

      const result = await controller.testSetPro(mockCampaign, testUser)

      expect(campaignsService.setIsPro).toHaveBeenCalledWith(
        mockCampaign.id,
        true,
        false,
      )
      expect(result).toEqual({ isPro: true })
    })
  })

  describe('getFilingInstructions', () => {
    it('returns the filing-instructions content for the caller campaign', async () => {
      const content = {
        filingWindow: 'June 1, 2026 – June 15, 2026',
        filingFee: 100,
        filingRequirementsText: 'Filing fee: $100.',
        filingOfficeAddress: '500 Election Way, Sacramento, CA 95814',
        filingPhoneNumber: '(916) 555-0199',
        paperworkInstructions: 'Submit to the city clerk.',
      }
      vi.spyOn(filingInstructionsService, 'getContent').mockResolvedValue(
        content,
      )

      const result = await controller.getFilingInstructions(mockCampaign)

      expect(filingInstructionsService.getContent).toHaveBeenCalledWith(
        mockCampaign,
      )
      expect(result).toEqual(content)
    })
  })

  describe('getCampaignPlanVersion', () => {
    it('returns version.data', async () => {
      const versionData = {
        key: [{ date: CREATED_AT, text: 'plan content' }],
      }
      vi.spyOn(planVersionsService, 'findByCampaignId').mockResolvedValue({
        id: 1,
        createdAt: new Date(CREATED_AT),
        updatedAt: new Date(CREATED_AT),
        campaignId: mockCampaign.id,
        data: versionData,
      })

      const result = await controller.getCampaignPlanVersion(mockCampaign)

      expect(planVersionsService.findByCampaignId).toHaveBeenCalledWith(
        mockCampaign.id,
      )
      expect(result).toEqual(versionData)
    })

    it('throws NotFoundException when no version found', async () => {
      vi.spyOn(planVersionsService, 'findByCampaignId').mockResolvedValue(null)

      await expect(
        controller.getCampaignPlanVersion(mockCampaign),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('findBySlug', () => {
    it('returns campaign with resolved positionName', async () => {
      const campaignWithOrg = {
        ...mockCampaign,
        organization: { customPositionName: null, positionId: 'pos-1' },
      }
      vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(campaignWithOrg)
      vi.spyOn(
        organizationsService,
        'resolvePositionContext',
      ).mockResolvedValue({
        ballotReadyPositionId: 'br-pos-1',
        positionName: 'Mayor',
      })

      const result = await controller.findBySlug(mockCampaign.slug)

      expect(campaignsService.findFirst).toHaveBeenCalledWith({
        where: { slug: mockCampaign.slug },
        include: {
          organization: {
            select: { customPositionName: true, positionId: true },
          },
        },
      })
      expect(organizationsService.resolvePositionContext).toHaveBeenCalledWith({
        customPositionName: null,
        positionId: 'pos-1',
      })
      expect(result).toEqual({
        ...campaignWithOrg,
        positionName: 'Mayor',
        raceTargetMetrics: null,
      })
    })

    it('returns null positionName when no organization', async () => {
      const campaignWithOrg = {
        ...mockCampaign,
        organization: null,
      }
      vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(campaignWithOrg)
      vi.spyOn(
        organizationsService,
        'resolvePositionContext',
      ).mockResolvedValue({
        ballotReadyPositionId: null,
        positionName: null,
      })

      const result = await controller.findBySlug(mockCampaign.slug)

      expect(organizationsService.resolvePositionContext).toHaveBeenCalledWith({
        customPositionName: undefined,
        positionId: undefined,
      })
      expect(result.positionName).toBeNull()
    })

    it('throws NotFoundException when slug not found', async () => {
      vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(null)

      await expect(controller.findBySlug('nonexistent')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('includes live metrics in raceTargetMetrics', async () => {
      const liveMetrics = {
        projectedTurnout: 5000,
        winNumber: 2501,
        voterContactGoal: 12505,
        filingFee: null,
        filingRequirementsText: null,
        ...EMPTY_RACE_CONTEXT_FIELDS,
      }
      vi.spyOn(
        campaignsService,
        'fetchLiveRaceTargetMetrics',
      ).mockResolvedValue(liveMetrics)

      const campaignWithOrg = {
        ...mockCampaign,
        organization: { customPositionName: null, positionId: 'pos-1' },
      }
      vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(campaignWithOrg)

      const result = await controller.findBySlug(mockCampaign.slug)

      expect(result.raceTargetMetrics).toEqual(liveMetrics)
      expect(result.positionName).toBe('Mayor')
    })
  })

  describe('create', () => {
    const mockCreateBody = {
      details: { state: 'CA' },
      ballotReadyPositionId: 'br-pos-1',
    } as CreateCampaignSchema

    it('throws ConflictException when not eligible to start a campaign', async () => {
      vi.spyOn(eligibilityService, 'evaluate').mockResolvedValue({
        hasActiveCampaign: true,
        holdsOffice: false,
        canStartCampaign: false,
        canGainOffice: true,
        reelectionOfficeSlug: null,
      })

      await expect(controller.create(mockUser, mockCreateBody)).rejects.toThrow(
        ConflictException,
      )
    })

    it('creates campaign for user when eligible to start one', async () => {
      vi.spyOn(eligibilityService, 'evaluate').mockResolvedValue({
        hasActiveCampaign: false,
        holdsOffice: false,
        canStartCampaign: true,
        canGainOffice: true,
        reelectionOfficeSlug: null,
      })
      vi.spyOn(campaignsService, 'createForUser').mockResolvedValue(
        mockCampaign,
      )

      const result = await controller.create(mockUser, mockCreateBody)

      expect(campaignsService.createForUser).toHaveBeenCalledWith(
        mockUser,
        { details: { state: 'CA' }, data: undefined },
        {
          ballotReadyPositionId: 'br-pos-1',
          customPositionName: undefined,
        },
      )
      expect(result).toEqual(mockCampaign)
    })
  })

  describe('update', () => {
    it('throws ForbiddenException for canDownloadFederal when not admin', async () => {
      await expect(
        controller.update(mockUser, mockCampaign, {
          canDownloadFederal: true,
        }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('allows admin to set canDownloadFederal', async () => {
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        mockCampaign,
      )

      await controller.update(mockAdminUser, mockCampaign, {
        canDownloadFederal: true,
      })

      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockCampaign.id,
        { canDownloadFederal: true },
      )
    })

    it('admin can override campaign via slug param', async () => {
      vi.spyOn(campaignsService, 'findFirstOrThrow').mockResolvedValue(
        mockOtherCampaign,
      )
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        mockOtherCampaign,
      )

      await controller.update(mockAdminUser, mockCampaign, {
        slug: OVERRIDE_SLUG,
        data: { foo: 'bar' },
      })

      expect(campaignsService.findFirstOrThrow).toHaveBeenCalledWith({
        where: { slug: OVERRIDE_SLUG },
      })
      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockOtherCampaign.id,
        { data: { foo: 'bar' } },
      )
    })

    it('sales can override campaign via slug param', async () => {
      vi.spyOn(campaignsService, 'findFirstOrThrow').mockResolvedValue(
        mockOtherCampaign,
      )
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        mockOtherCampaign,
      )

      await controller.update(mockSalesUser, mockCampaign, {
        slug: OVERRIDE_SLUG,
        data: { foo: 'bar' },
      })

      expect(campaignsService.findFirstOrThrow).toHaveBeenCalledWith({
        where: { slug: OVERRIDE_SLUG },
      })
      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockOtherCampaign.id,
        { data: { foo: 'bar' } },
      )
    })

    it('sends office facts to group() and pledged to identify on slug override', async () => {
      const campaignWithUserId: Campaign = {
        ...mockOtherCampaign,
        userId: 5,
        organizationSlug: 'campaign-200',
      }
      vi.spyOn(campaignsService, 'findFirstOrThrow').mockResolvedValue(
        campaignWithUserId,
      )
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        campaignWithUserId,
      )
      vi.spyOn(analyticsService, 'identify').mockResolvedValue(undefined)
      vi.spyOn(analyticsService, 'group').mockResolvedValue(undefined)

      await controller.update(mockAdminUser, mockCampaign, {
        slug: OVERRIDE_SLUG,
        details: {
          city: 'Springfield',
          electionDate: '2025-11-04',
          party: 'Independent',
          pledged: true,
        },
      })

      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockOtherCampaign.id,
        {
          details: {
            city: 'Springfield',
            electionDate: '2025-11-04',
            party: 'Independent',
            pledged: true,
          },
        },
      )

      // Campaign-scoped facts ride the org-scoped group(), not the user
      // identity (which a second campaign would overwrite).
      expect(analyticsService.group).toHaveBeenCalledWith(5, 'campaign-200', {
        officeMunicipality: 'Springfield',
        officeElectionDate: '2025-11-04',
        affiliation: 'Independent',
      })
      expect(analyticsService.identify).toHaveBeenCalledWith(5, {
        pledged: true,
      })
    })

    it('does not call analytics.identify or group when details is missing', async () => {
      const campaignWithUserId: Campaign = { ...mockOtherCampaign, userId: 5 }
      vi.spyOn(campaignsService, 'findFirstOrThrow').mockResolvedValue(
        campaignWithUserId,
      )
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        campaignWithUserId,
      )

      await controller.update(mockAdminUser, mockCampaign, {
        slug: OVERRIDE_SLUG,
        data: { foo: 'bar' },
      })

      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockOtherCampaign.id,
        { data: { foo: 'bar' } },
      )

      expect(analyticsService.identify).not.toHaveBeenCalled()
      expect(analyticsService.group).not.toHaveBeenCalled()
    })

    it('groups only truthy office facts and skips identify without pledged', async () => {
      const campaignWithUserId: Campaign = {
        ...mockOtherCampaign,
        userId: 5,
        organizationSlug: 'campaign-200',
      }
      vi.spyOn(campaignsService, 'findFirstOrThrow').mockResolvedValue(
        campaignWithUserId,
      )
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        campaignWithUserId,
      )
      vi.spyOn(analyticsService, 'identify').mockResolvedValue(undefined)
      vi.spyOn(analyticsService, 'group').mockResolvedValue(undefined)

      await controller.update(mockAdminUser, mockCampaign, {
        slug: OVERRIDE_SLUG,
        details: { city: 'Springfield' },
      })

      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockOtherCampaign.id,
        { details: { city: 'Springfield' } },
      )

      expect(analyticsService.group).toHaveBeenCalledWith(5, 'campaign-200', {
        officeMunicipality: 'Springfield',
      })
      expect(analyticsService.identify).not.toHaveBeenCalled()
    })

    it('groups each edited campaign under its own slug, never the other', async () => {
      vi.spyOn(analyticsService, 'identify').mockResolvedValue(undefined)
      vi.spyOn(analyticsService, 'group').mockResolvedValue(undefined)

      // Admin edits campaign B (the override-slug target) while their request
      // campaign A is something else — group must key on B, not A.
      const campaignB: Campaign = {
        ...mockOtherCampaign,
        userId: 5,
        organizationSlug: 'campaign-200',
      }

      vi.spyOn(campaignsService, 'findFirstOrThrow').mockResolvedValueOnce(
        campaignB,
      )
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        campaignB,
      )

      await controller.update(mockAdminUser, mockCampaign, {
        slug: OVERRIDE_SLUG,
        details: { city: 'Capital City', party: 'Green' },
      })

      // Editing B groups under B's slug; A's slug (campaign-100) is never touched.
      expect(analyticsService.group).toHaveBeenCalledWith(5, 'campaign-200', {
        officeMunicipality: 'Capital City',
        affiliation: 'Green',
      })
      expect(analyticsService.group).not.toHaveBeenCalledWith(
        5,
        'campaign-100',
        expect.anything(),
      )
    })

    it('throws NotFoundException when no campaign and no slug override', async () => {
      await expect(
        controller.update(mockUser, undefined!, {
          data: { foo: 'bar' },
        }),
      ).rejects.toThrow(NotFoundException)
    })

    it('updates campaign with body fields', async () => {
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        mockCampaign,
      )

      const body = { data: { currentStep: 'goals' } }
      const result = await controller.update(mockUser, mockCampaign, body)

      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockCampaign.id,
        { data: { currentStep: 'goals' } },
      )
      expect(result).toEqual(mockCampaign)
    })
  })

  describe('findById (M2M GET :id)', () => {
    it('returns campaign enriched with positionName and raceTargetMetrics', async () => {
      vi.spyOn(campaignsService, 'findUniqueOrThrow').mockResolvedValue(
        mockCampaign,
      )

      const result = await controller.findById({ id: mockCampaign.id })

      expect(campaignsService.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: mockCampaign.id },
        include: {
          organization: {
            select: {
              customPositionName: true,
              positionId: true,
            },
          },
        },
      })
      expect(result).toHaveProperty('id', mockCampaign.id)
      expect(result).toHaveProperty('positionName')
      expect(result).toHaveProperty('raceTargetMetrics')
    })

    it('throws when campaign does not exist', async () => {
      vi.spyOn(campaignsService, 'findUniqueOrThrow').mockRejectedValue(
        new NotFoundException(),
      )

      await expect(controller.findById({ id: 999 })).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('updateCampaign (M2M PUT :id)', () => {
    beforeEach(() => {
      vi.spyOn(campaignsService, 'findUniqueOrThrow').mockResolvedValue(
        mockCampaign,
      )
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        mockCampaign,
      )
    })

    it('throws NotFoundException when campaign does not exist', async () => {
      vi.spyOn(campaignsService, 'findUniqueOrThrow').mockRejectedValue(
        new NotFoundException(),
      )

      await expect(
        controller.updateCampaign({ id: 999 }, { isActive: true }),
      ).rejects.toThrow(NotFoundException)
    })

    it('updates scalar fields only', async () => {
      const result = await controller.updateCampaign(
        { id: mockCampaign.id },
        { isActive: false, slug: 'new-slug' },
      )

      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockCampaign.id,
        { data: undefined, details: undefined, aiContent: undefined },
        true,
        { isActive: false, slug: 'new-slug' },
      )
      expect(result).toEqual(mockCampaign)
    })

    it('updates JSON fields only', async () => {
      const result = await controller.updateCampaign(
        { id: mockCampaign.id },
        { data: { name: 'Updated' } },
      )

      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockCampaign.id,
        { data: { name: 'Updated' }, details: undefined, aiContent: undefined },
        true,
        undefined,
      )
      expect(result).toEqual(mockCampaign)
    })

    it('updates both scalar and JSON fields atomically', async () => {
      const result = await controller.updateCampaign(
        { id: mockCampaign.id },
        { isActive: true, data: { name: 'Updated' }, details: { city: 'LA' } },
      )

      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockCampaign.id,
        {
          data: { name: 'Updated' },
          details: { city: 'LA' },
          aiContent: undefined,
        },
        true,
        { isActive: true },
      )
      expect(result).toEqual(mockCampaign)
    })

    it('handles empty body without error', async () => {
      const result = await controller.updateCampaign(
        { id: mockCampaign.id },
        {},
      )

      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockCampaign.id,
        { data: undefined, details: undefined, aiContent: undefined },
        true,
        undefined,
      )
      expect(result).toEqual(mockCampaign)
    })

    it('returns raw data from service (interceptor handles response parsing)', async () => {
      const result = await controller.updateCampaign(
        { id: mockCampaign.id },
        { isActive: true },
      )

      expect(result).toHaveProperty('id')
    })
  })

  describe('launch', () => {
    it('returns launch result on success', async () => {
      vi.spyOn(campaignsService, 'launch').mockResolvedValue(true)

      const result = await controller.launch(mockCampaign)

      expect(campaignsService.launch).toHaveBeenCalledWith(mockCampaign)
      expect(result).toBe(true)
    })

    it('logs, sends Slack message, and re-throws on error', async () => {
      const error = new Error('Launch failed')
      vi.spyOn(campaignsService, 'launch').mockRejectedValue(error)
      vi.spyOn(slackService, 'errorMessage').mockResolvedValue(undefined)

      await expect(controller.launch(mockCampaign)).rejects.toThrow(
        'Launch failed',
      )

      expect(slackService.errorMessage).toHaveBeenCalledWith({
        message: 'Error at campaign launch',
        error,
      })
    })
  })

  describe('setDistrict', () => {
    const districtBody = {
      L2DistrictType: 'State Senate',
      L2DistrictName: 'District 5',
    }

    it('admin can override campaign via slug param', async () => {
      vi.spyOn(campaignsService, 'findFirstOrThrow').mockResolvedValue(
        mockOtherCampaign,
      )
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        mockOtherCampaign,
      )

      await controller.setDistrict(mockCampaign, mockAdminUser, {
        slug: OVERRIDE_SLUG,
        ...districtBody,
      })

      expect(campaignsService.findFirstOrThrow).toHaveBeenCalledWith({
        where: { slug: OVERRIDE_SLUG },
      })
    })

    it('throws NotFoundException when no campaign and no slug override', async () => {
      await expect(
        controller.setDistrict(undefined!, mockUser, districtBody),
      ).rejects.toThrow(NotFoundException)
    })

    it('passes overrideDistrictId to updateJsonFields', async () => {
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        mockCampaign,
      )
      vi.spyOn(
        organizationsService,
        'resolveOverrideDistrictId',
      ).mockResolvedValue('district-uuid-123')

      await controller.setDistrict(mockCampaign, mockUser, districtBody)

      expect(
        organizationsService.resolveOverrideDistrictId,
      ).toHaveBeenCalledWith({
        positionId: 'pos-1',
        state: 'CA',
        L2DistrictType: 'State Senate',
        L2DistrictName: 'District 5',
      })
      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockCampaign.id,
        { overrideDistrictId: 'district-uuid-123' },
      )
    })

    it('passes null overrideDistrictId when resolveOverrideDistrictId returns null', async () => {
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        mockCampaign,
      )
      vi.spyOn(
        organizationsService,
        'resolveOverrideDistrictId',
      ).mockResolvedValue(null)

      await controller.setDistrict(mockCampaign, mockUser, districtBody)

      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockCampaign.id,
        { overrideDistrictId: null },
      )
    })

    it('fails the request when resolveOverrideDistrictId rejects', async () => {
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        mockCampaign,
      )
      vi.spyOn(
        organizationsService,
        'resolveOverrideDistrictId',
      ).mockRejectedValue(new Error('Election API down'))

      await expect(
        controller.setDistrict(mockCampaign, mockUser, districtBody),
      ).rejects.toThrow('Election API down')
    })

    it('passes undefined positionId when campaign has no positionId', async () => {
      const campaignNoPosition: Campaign = {
        ...mockCampaign,
        details: { electionDate: '2025-11-04', state: 'CA' },
      }
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        mockCampaign,
      )
      vi.spyOn(organizationsService, 'findUnique').mockResolvedValue(null)

      await controller.setDistrict(campaignNoPosition, mockUser, districtBody)

      expect(
        organizationsService.resolveOverrideDistrictId,
      ).toHaveBeenCalledWith({
        positionId: undefined,
        state: 'CA',
        L2DistrictType: 'State Senate',
        L2DistrictName: 'District 5',
      })
    })
  })

  describe('setDistrictM2M', () => {
    const districtBody = {
      L2DistrictType: 'State Senate',
      L2DistrictName: 'District 5',
    }

    it('throws when campaign is not found', async () => {
      vi.spyOn(campaignsService, 'findUniqueOrThrow').mockRejectedValue(
        new NotFoundException('Campaign not found'),
      )

      await expect(
        controller.setDistrictM2M({ id: 999 }, districtBody),
      ).rejects.toThrow(NotFoundException)

      expect(campaignsService.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 999 },
      })
    })

    it('calls applyDistrictUpdate with the resolved campaign and district values', async () => {
      vi.spyOn(campaignsService, 'findUniqueOrThrow').mockResolvedValue(
        mockCampaign,
      )
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        mockCampaign,
      )

      await controller.setDistrictM2M({ id: mockCampaign.id }, districtBody)

      expect(campaignsService.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: mockCampaign.id },
      })
      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockCampaign.id,
        { overrideDistrictId: null },
      )
    })

    it('works without user context (M2M auth)', async () => {
      vi.spyOn(campaignsService, 'findUniqueOrThrow').mockResolvedValue(
        mockCampaign,
      )
      vi.spyOn(campaignsService, 'updateJsonFields').mockResolvedValue(
        mockCampaign,
      )

      const result = await controller.setDistrictM2M(
        { id: mockCampaign.id },
        districtBody,
      )

      expect(result).toBeDefined()
      expect(campaignsService.updateJsonFields).toHaveBeenCalledWith(
        mockCampaign.id,
        { overrideDistrictId: null },
      )
    })
  })
})
