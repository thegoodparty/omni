import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PinoLogger } from 'nestjs-pino'
import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import {
  Campaign,
  OutreachStatus,
  OutreachType,
  User,
} from '../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { P2P_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { AreaCodeFromZipService } from 'src/ai/util/areaCodeFromZip.util'
import { CampaignTcrComplianceService } from 'src/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { PrismaService } from 'src/prisma/prisma.service'
import { GooglePlacesService } from 'src/vendors/google/services/google-places.service'
import { VoterFileFilterService } from 'src/voters/services/voterFileFilter.service'
import { PeerlyP2pJobService } from 'src/vendors/peerly/services/peerlyP2pJob.service'
import { S3Service } from 'src/vendors/aws/services/s3.service'
import type {
  CampaignGeographyInput,
  ResolveP2pJobGeographyServices,
} from '../util/campaignGeography.util'
import type { CreateOutreachSchema } from '../schemas/createOutreachSchema'
import { OutreachMaterializationService } from './outreachMaterialization.service'
import { OutreachNotificationService } from './outreachNotification.service'
import { OutreachService, type P2pOutreachImageInput } from './outreach.service'

const mockOutreachCreate = vi.fn()
const mockOutreachFindMany = vi.fn()
const mockOutreachUpdateMany = vi.fn()
const mockOutreachUpdate = vi.fn()
const mockOutreachFindUniqueOrThrow = vi.fn()
const mockGetFileBytes = vi.fn()

const mockTcrFindFirstOrThrow = vi.fn()
const mockPeerlyCreateJob = vi.fn()
const mockResolveP2pJobGeography = vi.fn()
const mockNotifySuccess = vi.fn()
const mockFindVoterFileFilter = vi.fn()
const mockFilterAccessCheck = vi.fn()
const mockMaterializeOutreach = vi.fn()

vi.mock('../util/campaignGeography.util', () => ({
  resolveP2pJobGeography: (
    campaign: CampaignGeographyInput,
    services: ResolveP2pJobGeographyServices,
  ) => mockResolveP2pJobGeography(campaign, services),
}))

describe('OutreachService', () => {
  let service: OutreachService

  const mockUser = {
    id: 100,
    email: 'user@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
  } as User

  const mockCampaign = {
    id: 1,
    slug: 'jane-doe',
    organizationSlug: 'org-test',
    aiContent: {},
    data: { hubspotId: 'hub-1' },
    details: null,
  } as unknown as Campaign

  const baseCreateDto: CreateOutreachSchema = {
    campaignId: 1,
    outreachType: OutreachType.text,
    status: OutreachStatus.pending,
    date: '2025-02-01T12:00:00.000Z',
  }

  const p2pCreateDto: CreateOutreachSchema = {
    ...baseCreateDto,
    outreachType: OutreachType.p2p,
    script: 'smsKey',
    phoneListId: 100,
    title: 'P2P Title',
  }

  const p2pImage: P2pOutreachImageInput = {
    stream: Buffer.from('fake-image'),
    filename: 'image.png',
    mimetype: 'image/png',
  }

  beforeEach(async () => {
    mockOutreachCreate.mockReset()
    mockOutreachFindMany.mockReset()
    mockOutreachUpdateMany.mockReset()
    mockOutreachUpdate.mockReset()
    mockOutreachFindUniqueOrThrow.mockReset()
    mockGetFileBytes.mockReset()
    mockTcrFindFirstOrThrow.mockReset()
    mockPeerlyCreateJob.mockReset()
    mockResolveP2pJobGeography.mockReset()
    mockNotifySuccess.mockReset()
    mockNotifySuccess.mockResolvedValue(undefined)
    mockFindVoterFileFilter.mockReset()
    mockFilterAccessCheck.mockReset()
    mockFilterAccessCheck.mockResolvedValue(undefined)
    mockMaterializeOutreach.mockReset()
    mockMaterializeOutreach.mockResolvedValue(undefined)

    const mockPrismaService = {
      outreach: {
        create: mockOutreachCreate,
        findMany: mockOutreachFindMany,
        findFirst: vi.fn(),
        findFirstOrThrow: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: mockOutreachFindUniqueOrThrow,
        count: vi.fn(),
        updateMany: mockOutreachUpdateMany,
        update: mockOutreachUpdate,
      },
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PinoLogger, useValue: createMockLogger() },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: GooglePlacesService, useValue: {} },
        { provide: AreaCodeFromZipService, useValue: {} },
        {
          provide: CampaignTcrComplianceService,
          useValue: { findFirstOrThrow: mockTcrFindFirstOrThrow },
        },
        {
          provide: PeerlyP2pJobService,
          useValue: {
            createPeerlyP2pJob: mockPeerlyCreateJob,
          },
        },
        {
          provide: OutreachNotificationService,
          useValue: { notifySuccess: mockNotifySuccess },
        },
        {
          provide: VoterFileFilterService,
          useValue: {
            findByIdAndOrganizationSlug: mockFindVoterFileFilter,
            filterAccessCheck: mockFilterAccessCheck,
          },
        },
        {
          provide: OutreachMaterializationService,
          useValue: {
            materializeOutreach: mockMaterializeOutreach,
          },
        },
        {
          provide: S3Service,
          useValue: { getFileBytesWithContentType: mockGetFileBytes },
        },
        OutreachService,
      ],
    }).compile()

    await module.init()
    service = module.get(OutreachService)

    Object.defineProperty(service, 'logger', {
      get: () => createMockLogger(),
      configurable: true,
    })
  })

  describe('create', () => {
    it('creates non-P2P outreach via createRecord when p2pImage is not provided', async () => {
      const imageUrl = 'https://cdn.example.com/image.png'
      const created = {
        id: 1,
        ...baseCreateDto,
        imageUrl,
        voterFileFilter: null,
      }
      mockOutreachCreate.mockResolvedValue(created)

      const result = await service.create(
        mockUser,
        mockCampaign,
        baseCreateDto,
        imageUrl,
        undefined,
      )

      expect(mockOutreachCreate).toHaveBeenCalledTimes(1)
      expect(mockOutreachCreate).toHaveBeenCalledWith({
        data: {
          ...baseCreateDto,
          organizationSlug: mockCampaign.organizationSlug,
          imageUrl,
        },
        include: { voterFileFilter: true },
      })
      expect(result).toEqual(created)
    })

    it('hands the created outreach to list materialization', async () => {
      const created = { id: 9, ...baseCreateDto, voterFileFilter: null }
      mockOutreachCreate.mockResolvedValue(created)

      await service.create(
        mockUser,
        mockCampaign,
        baseCreateDto,
        undefined,
        undefined,
      )

      expect(mockMaterializeOutreach).toHaveBeenCalledWith(
        mockCampaign,
        created,
      )
    })

    it('still returns the outreach when materialization throws', async () => {
      const created = { id: 10, ...baseCreateDto, voterFileFilter: null }
      mockOutreachCreate.mockResolvedValue(created)
      mockMaterializeOutreach.mockRejectedValue(new Error('people api down'))

      const result = await service.create(
        mockUser,
        mockCampaign,
        baseCreateDto,
        undefined,
        undefined,
      )

      expect(result).toEqual(created)
    })

    it('hands the finalized outreach to list materialization on purchase finalize', async () => {
      const draft = {
        id: 42,
        campaignId: 1,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.pending,
        imageUrl: 'https://assets.goodparty.org/outreach/img.png',
        phoneListId: 100,
        script: 'hello voter',
        identityId: 'ident-1',
        title: 'P2P Title',
        name: null,
        didState: null,
        didNpaSubset: null,
        date: new Date('2025-02-01T12:00:00.000Z'),
        audienceRequest: null,
        campaignPlanDueDate: null,
        textCount: null,
        billableTextCount: null,
        voterFileFilterId: 7,
        voterFileFilter: null,
        campaign: { ...mockCampaign, user: mockUser },
      }
      mockOutreachUpdateMany.mockResolvedValue({ count: 1 })
      mockOutreachFindUniqueOrThrow.mockResolvedValue(draft)
      mockGetFileBytes.mockResolvedValue({
        bytes: Buffer.from('img'),
        contentType: 'image/png',
      })
      mockPeerlyCreateJob.mockResolvedValue('job-123')
      mockOutreachUpdate.mockResolvedValue({})

      await service.finalizeOutreachPurchase(42, 1)

      expect(mockMaterializeOutreach).toHaveBeenCalledWith(
        draft.campaign,
        expect.objectContaining({ id: 42, projectId: 'job-123' }),
      )
    })

    it('materializes on finalize even when the campaign has no user', async () => {
      const draft = {
        id: 43,
        campaignId: 1,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.pending,
        imageUrl: 'https://assets.goodparty.org/outreach/img.png',
        phoneListId: 100,
        script: 'hello voter',
        identityId: 'ident-1',
        title: 'P2P Title',
        name: null,
        didState: null,
        didNpaSubset: null,
        date: new Date('2025-02-01T12:00:00.000Z'),
        audienceRequest: null,
        campaignPlanDueDate: null,
        textCount: null,
        billableTextCount: null,
        voterFileFilterId: 7,
        voterFileFilter: null,
        campaign: { ...mockCampaign, user: null },
      }
      mockOutreachUpdateMany.mockResolvedValue({ count: 1 })
      mockOutreachFindUniqueOrThrow.mockResolvedValue(draft)
      mockGetFileBytes.mockResolvedValue({
        bytes: Buffer.from('img'),
        contentType: 'image/png',
      })
      mockPeerlyCreateJob.mockResolvedValue('job-456')
      mockOutreachUpdate.mockResolvedValue({})

      await service.finalizeOutreachPurchase(43, 1)

      expect(mockMaterializeOutreach).toHaveBeenCalledWith(
        draft.campaign,
        expect.objectContaining({ id: 43, projectId: 'job-456' }),
      )
      expect(mockNotifySuccess).not.toHaveBeenCalled()
    })

    it('forwards campaignPlanDueDate from the DTO into notifySuccess', async () => {
      const dto: CreateOutreachSchema = {
        ...baseCreateDto,
        campaignPlanDueDate: '2026-04-19',
      }
      mockOutreachCreate.mockResolvedValue({
        id: 1,
        ...dto,
        voterFileFilter: null,
      })

      await service.create(mockUser, mockCampaign, dto, undefined, undefined)

      expect(mockNotifySuccess).toHaveBeenCalledWith(
        expect.objectContaining({ campaignPlanDueDate: '2026-04-19' }),
      )
    })

    it('persists campaignPlanDueDate on the outreach row', async () => {
      const dto: CreateOutreachSchema = {
        ...baseCreateDto,
        campaignPlanDueDate: '2026-04-19',
      }
      mockOutreachCreate.mockResolvedValue({
        id: 1,
        ...dto,
        voterFileFilter: null,
      })

      await service.create(mockUser, mockCampaign, dto, undefined, undefined)

      const [createArg] = firstOrThrow(mockOutreachCreate.mock.calls)
      expect(createArg.data).toHaveProperty('campaignPlanDueDate', '2026-04-19')
    })

    it('forwards text counts into notifySuccess and persists them', async () => {
      const dto: CreateOutreachSchema = {
        ...baseCreateDto,
        textCount: 5200,
        billableTextCount: 200,
      }
      mockOutreachCreate.mockResolvedValue({
        id: 1,
        ...dto,
        voterFileFilter: null,
      })

      await service.create(mockUser, mockCampaign, dto, undefined, undefined)

      expect(mockNotifySuccess).toHaveBeenCalledWith(
        expect.objectContaining({ textCount: 5200, billableTextCount: 200 }),
      )
      const [createArg] = firstOrThrow(mockOutreachCreate.mock.calls)
      expect(createArg.data).toMatchObject({
        textCount: 5200,
        billableTextCount: 200,
      })
    })

    it('creates non-P2P outreach without imageUrl when both omitted', async () => {
      const created = { id: 1, ...baseCreateDto, voterFileFilter: null }
      mockOutreachCreate.mockResolvedValue(created)

      await service.create(
        mockUser,
        mockCampaign,
        baseCreateDto,
        undefined,
        undefined,
      )

      expect(mockOutreachCreate).toHaveBeenCalledWith({
        data: {
          ...baseCreateDto,
          organizationSlug: mockCampaign.organizationSlug,
        },
        include: { voterFileFilter: true },
      })
    })

    it('runs P2P flow and createRecord when p2pImage and imageUrl are provided', async () => {
      mockTcrFindFirstOrThrow.mockResolvedValue({
        peerlyIdentityId: 'identity-123',
      })
      mockResolveP2pJobGeography.mockResolvedValue({
        didState: 'CA',
        didNpaSubset: ['415', '510'],
      })
      mockPeerlyCreateJob.mockResolvedValue('job-id-456')
      const created = {
        id: 2,
        ...p2pCreateDto,
        projectId: 'job-id-456',
        script: 'Resolved script text',
        status: OutreachStatus.pending,
        didState: 'CA',
        didNpaSubset: ['415', '510'],
        imageUrl: 'https://cdn.example.com/p2p.png',
        voterFileFilter: null,
      }
      mockOutreachCreate.mockResolvedValue(created)

      const result = await service.create(
        mockUser,
        mockCampaign,
        p2pCreateDto,
        'https://cdn.example.com/p2p.png',
        p2pImage,
      )

      expect(mockTcrFindFirstOrThrow).toHaveBeenCalledWith({
        where: { campaignId: mockCampaign.id },
      })
      expect(mockResolveP2pJobGeography).toHaveBeenCalledWith(
        mockCampaign,
        expect.objectContaining({
          placesService: expect.anything(),
          areaCodeFromZipService: expect.anything(),
        }),
      )
      expect(mockPeerlyCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({
          campaignId: mockCampaign.id,
          listId: p2pCreateDto.phoneListId,
          identityId: 'identity-123',
          didState: 'CA',
          didNpaSubset: ['415', '510'],
          imageInfo: {
            fileStream: p2pImage.stream,
            fileName: p2pImage.filename,
            mimeType: p2pImage.mimetype,
            title: p2pCreateDto.title,
          },
        }),
      )
      expect(mockOutreachCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ...p2pCreateDto,
          organizationSlug: mockCampaign.organizationSlug,
          projectId: 'job-id-456',
          status: OutreachStatus.pending,
          didState: 'CA',
          didNpaSubset: ['415', '510'],
          imageUrl: 'https://cdn.example.com/p2p.png',
        }),
        include: { voterFileFilter: true },
      })
      // P2P materializes the resolved filter into interaction rows.
      expect(mockMaterializeOutreach).toHaveBeenCalledWith(
        mockCampaign,
        created,
      )
      expect(result).toEqual(created)
    })

    it('throws BadRequest when the resolved P2P script exceeds the MMS limit', async () => {
      mockTcrFindFirstOrThrow.mockResolvedValue({
        peerlyIdentityId: 'identity-123',
      })
      // The DTO script is a short aiContent key; the oversized text only
      // appears after resolution, so schema validation alone can't catch it.
      const campaignWithLongScript = {
        ...mockCampaign,
        aiContent: {
          smsKey: { content: 'x'.repeat(P2P_SCRIPT_MAX_LENGTH + 1) },
        },
      } as unknown as Campaign

      await expect(
        service.create(
          mockUser,
          campaignWithLongScript,
          p2pCreateDto,
          'https://cdn.example.com/p2p.png',
          p2pImage,
        ),
      ).rejects.toThrow(BadRequestException)

      expect(mockPeerlyCreateJob).not.toHaveBeenCalled()
      expect(mockOutreachCreate).not.toHaveBeenCalled()
    })

    it('throws BadRequest when P2P flow has no peerlyIdentityId', async () => {
      mockTcrFindFirstOrThrow.mockResolvedValue({ peerlyIdentityId: null })

      await expect(
        service.create(
          mockUser,
          mockCampaign,
          p2pCreateDto,
          'https://cdn.example.com/p2p.png',
          p2pImage,
        ),
      ).rejects.toThrow(BadRequestException)

      expect(mockPeerlyCreateJob).not.toHaveBeenCalled()
      expect(mockOutreachCreate).not.toHaveBeenCalled()
    })

    it('throws BadRequest when P2P is requested without imageUrl or p2pImage', async () => {
      await expect(
        service.create(
          mockUser,
          mockCampaign,
          p2pCreateDto,
          undefined,
          p2pImage,
        ),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.create(
          mockUser,
          mockCampaign,
          p2pCreateDto,
          undefined,
          p2pImage,
        ),
      ).rejects.toThrow(/required for P2P outreach/)

      await expect(
        service.create(
          mockUser,
          mockCampaign,
          p2pCreateDto,
          'https://cdn.example.com/p2p.png',
          undefined,
        ),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.create(
          mockUser,
          mockCampaign,
          p2pCreateDto,
          'https://cdn.example.com/p2p.png',
          undefined,
        ),
      ).rejects.toThrow(/filename and MIME type|Peerly job setup/)

      expect(mockTcrFindFirstOrThrow).not.toHaveBeenCalled()
      expect(mockOutreachCreate).not.toHaveBeenCalled()
    })

    it('succeeds when voterFileFilterId belongs to the campaign org', async () => {
      const dto: CreateOutreachSchema = {
        ...baseCreateDto,
        voterFileFilterId: 42,
      }
      mockFindVoterFileFilter.mockResolvedValue({
        id: 42,
        organizationSlug: 'org-test',
      })
      const created = {
        id: 1,
        ...dto,
        voterFileFilter: { id: 42 },
      }
      mockOutreachCreate.mockResolvedValue(created)

      const result = await service.create(
        mockUser,
        mockCampaign,
        dto,
        undefined,
        undefined,
      )

      expect(mockFindVoterFileFilter).toHaveBeenCalledWith(42, 'org-test')
      expect(mockFilterAccessCheck).toHaveBeenCalledWith('org-test')
      expect(mockOutreachCreate).toHaveBeenCalledTimes(1)
      expect(result).toEqual(created)
    })

    it('throws NotFoundException when voterFileFilterId does not belong to the campaign org', async () => {
      const dto: CreateOutreachSchema = {
        ...baseCreateDto,
        voterFileFilterId: 99,
      }
      mockFindVoterFileFilter.mockResolvedValue(null)

      await expect(
        service.create(mockUser, mockCampaign, dto, undefined, undefined),
      ).rejects.toThrow(NotFoundException)
      await expect(
        service.create(mockUser, mockCampaign, dto, undefined, undefined),
      ).rejects.toThrow(/Voter file filter not found/)

      expect(mockFilterAccessCheck).toHaveBeenCalledWith('org-test')
      expect(mockFindVoterFileFilter).toHaveBeenCalledWith(99, 'org-test')
      expect(mockOutreachCreate).not.toHaveBeenCalled()
    })

    it('throws BadRequest when filterAccessCheck rejects a non-pro campaign', async () => {
      const dto: CreateOutreachSchema = {
        ...baseCreateDto,
        voterFileFilterId: 42,
      }
      mockFilterAccessCheck.mockRejectedValue(
        new BadRequestException('Campaign is not pro'),
      )

      await expect(
        service.create(mockUser, mockCampaign, dto, undefined, undefined),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.create(mockUser, mockCampaign, dto, undefined, undefined),
      ).rejects.toThrow(/Campaign is not pro/)

      expect(mockFindVoterFileFilter).not.toHaveBeenCalled()
      expect(mockOutreachCreate).not.toHaveBeenCalled()
    })

    it('tags TCR lookup failures as OutreachStepError(tcrLookup)', async () => {
      mockTcrFindFirstOrThrow.mockRejectedValue(new Error('TCR not found'))

      await expect(
        service.create(
          mockUser,
          mockCampaign,
          p2pCreateDto,
          'https://cdn.example.com/p2p.png',
          p2pImage,
        ),
      ).rejects.toThrow(BadGatewayException)

      await expect(
        service.create(
          mockUser,
          mockCampaign,
          p2pCreateDto,
          'https://cdn.example.com/p2p.png',
          p2pImage,
        ),
      ).rejects.toThrow(/step "tcrLookup"/)
    })
  })

  describe('findByCampaignId', () => {
    it('returns outreach list when campaign has outreaches', async () => {
      const list = [
        { id: 1, campaignId: 1, voterFileFilter: null },
        { id: 2, campaignId: 1, voterFileFilter: null },
      ]
      mockOutreachFindMany.mockResolvedValue(list)

      const result = await service.findByCampaignId(1)

      expect(mockOutreachFindMany).toHaveBeenCalledWith({
        where: {
          campaignId: 1,
          OR: [
            { status: { not: OutreachStatus.pending_payment } },
            { status: null },
          ],
        },
        include: { voterFileFilter: true },
      })
      expect(result).toEqual(list)
    })

    it('throws NotFoundException when no outreaches exist for campaign', async () => {
      mockOutreachFindMany.mockResolvedValue([])

      await expect(service.findByCampaignId(999)).rejects.toThrow(
        NotFoundException,
      )
      await expect(service.findByCampaignId(999)).rejects.toThrow(
        /No outreach campaigns found for campaign ID 999/,
      )
    })
  })
})
