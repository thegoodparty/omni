import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import {
  Campaign,
  Organization,
  OutreachStatus,
  OutreachType,
  User,
} from '../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutreachController } from './outreach.controller'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

describe('OutreachController', () => {
  let controller: OutreachController
  let mockOutreachService: {
    create: ReturnType<typeof vi.fn>
    findByCampaignId: ReturnType<typeof vi.fn>
  }
  let mockS3Service: {
    buildKey: ReturnType<typeof vi.fn>
    uploadFile: ReturnType<typeof vi.fn>
  }
  let mockContactsService: { assertProAccess: ReturnType<typeof vi.fn> }

  const mockUser = {
    id: 100,
    email: 'user@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
  } as User

  const baseCampaign = {
    id: 1,
    slug: 'jane-doe',
    aiContent: {},
    data: {},
  } as Campaign

  const baseOrganization = { slug: 'campaign-1' } as Organization

  const textDto = {
    campaignId: 1,
    outreachType: OutreachType.text,
    status: OutreachStatus.pending,
    date: '2025-02-01T12:00:00.000Z',
  }

  const p2pDto = {
    campaignId: 1,
    outreachType: OutreachType.p2p,
    status: OutreachStatus.pending,
    date: '2025-02-01T12:00:00.000Z',
    script: 'smsKey',
    phoneListId: 100,
    title: 'P2P Title',
  }

  const mockImage = {
    data: Buffer.from('fake-image'),
    filename: 'image.png',
    mimetype: 'image/png',
    encoding: '7bit',
    fieldname: 'file',
  }

  beforeEach(() => {
    mockOutreachService = {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      findByCampaignId: vi.fn().mockResolvedValue([]),
    }
    mockS3Service = {
      buildKey: vi.fn(
        (folder?: string, fileName?: string) =>
          `${folder ?? ''}/${fileName ?? ''}`,
      ),
      uploadFile: vi
        .fn()
        .mockResolvedValue('https://cdn.example.com/image.png'),
    }
    mockContactsService = { assertProAccess: vi.fn() }

    controller = new OutreachController(
      mockOutreachService as never,
      mockS3Service as never,
      mockContactsService as never,
      createMockLogger(),
    )
    vi.clearAllMocks()
  })

  describe('create', () => {
    it('throws UnauthorizedException when campaign ID does not match DTO', async () => {
      const mismatchedDto = { ...textDto, campaignId: 999 }

      await expect(
        controller.create(
          mockUser,
          baseCampaign,
          baseOrganization,
          mismatchedDto as never,
          mockImage as never,
        ),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('throws BadRequestException when text outreach has no image', async () => {
      await expect(
        controller.create(
          mockUser,
          baseCampaign,
          baseOrganization,
          textDto as never,
          undefined,
        ),
      ).rejects.toThrow(BadRequestException)
      await expect(
        controller.create(
          mockUser,
          baseCampaign,
          baseOrganization,
          textDto as never,
          undefined,
        ),
      ).rejects.toThrow(/Image is required for text outreach/)
    })

    it('throws BadRequestException when P2P outreach has no image', async () => {
      await expect(
        controller.create(
          mockUser,
          baseCampaign,
          baseOrganization,
          p2pDto as never,
          undefined,
        ),
      ).rejects.toThrow(BadRequestException)
      await expect(
        controller.create(
          mockUser,
          baseCampaign,
          baseOrganization,
          p2pDto as never,
          undefined,
        ),
      ).rejects.toThrow(/Image is required for p2p outreach/)
    })

    it('throws BadRequestException when P2P image is missing filename', async () => {
      const noFilenameImage = { ...mockImage, filename: undefined }

      await expect(
        controller.create(
          mockUser,
          baseCampaign,
          baseOrganization,
          p2pDto as never,
          noFilenameImage as never,
        ),
      ).rejects.toThrow(BadRequestException)
      await expect(
        controller.create(
          mockUser,
          baseCampaign,
          baseOrganization,
          p2pDto as never,
          noFilenameImage as never,
        ),
      ).rejects.toThrow(/filename and MIME type are required/)
    })

    it('throws BadRequestException when P2P image is missing mimetype', async () => {
      const noMimetypeImage = { ...mockImage, mimetype: undefined }

      await expect(
        controller.create(
          mockUser,
          baseCampaign,
          baseOrganization,
          p2pDto as never,
          noMimetypeImage as never,
        ),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when P2P image upload fails (no imageUrl)', async () => {
      mockS3Service.uploadFile.mockResolvedValue(undefined)

      await expect(
        controller.create(
          mockUser,
          baseCampaign,
          baseOrganization,
          p2pDto as never,
          mockImage as never,
        ),
      ).rejects.toThrow(BadRequestException)
      await expect(
        controller.create(
          mockUser,
          baseCampaign,
          baseOrganization,
          p2pDto as never,
          mockImage as never,
        ),
      ).rejects.toThrow(/Failed to upload image/)
    })

    it('creates text outreach with uploaded imageUrl', async () => {
      mockS3Service.uploadFile.mockResolvedValue(
        'https://cdn.example.com/uploaded.png',
      )
      mockOutreachService.create.mockResolvedValue({ id: 1, ...textDto })

      await controller.create(
        mockUser,
        baseCampaign,
        baseOrganization,
        textDto as never,
        mockImage as never,
      )

      expect(mockS3Service.buildKey).toHaveBeenCalledWith(
        expect.stringContaining('scheduled-campaign/jane-doe/text/'),
        mockImage.filename,
      )
      expect(mockS3Service.uploadFile).toHaveBeenCalledWith(
        expect.any(String),
        mockImage.data,
        expect.stringContaining('scheduled-campaign/jane-doe/text/'),
        expect.objectContaining({
          contentType: mockImage.mimetype,
          cacheControl: expect.stringContaining('max-age='),
        }),
      )
      expect(mockOutreachService.create).toHaveBeenCalledWith(
        mockUser,
        baseCampaign,
        textDto,
        'https://cdn.example.com/uploaded.png',
      )
    })

    it('creates P2P outreach with the uploaded imageUrl', async () => {
      mockS3Service.uploadFile.mockResolvedValue(
        'https://cdn.example.com/p2p.png',
      )
      mockOutreachService.create.mockResolvedValue({ id: 2, ...p2pDto })

      await controller.create(
        mockUser,
        baseCampaign,
        baseOrganization,
        p2pDto as never,
        mockImage as never,
      )

      expect(mockOutreachService.create).toHaveBeenCalledWith(
        mockUser,
        baseCampaign,
        p2pDto,
        'https://cdn.example.com/p2p.png',
      )
    })

    it('creates outreach without image when outreachType does not require one', async () => {
      const emailDto = {
        ...textDto,
        outreachType: 'email' as OutreachType,
      }

      await controller.create(
        mockUser,
        baseCampaign,
        baseOrganization,
        emailDto as never,
        undefined,
      )

      expect(mockS3Service.uploadFile).not.toHaveBeenCalled()
      expect(mockOutreachService.create).toHaveBeenCalledWith(
        mockUser,
        baseCampaign,
        emailDto,
        undefined,
      )
    })
  })

  describe('findAll', () => {
    // One texting row the vendor has a job for, and one door-knocking row it
    // has nothing to do with.
    const p2pRow = {
      id: 10,
      projectId: 'job-1',
      outreachType: OutreachType.p2p,
      status: OutreachStatus.pending,
    }
    const doorKnockingRow = {
      id: 11,
      projectId: null,
      outreachType: OutreachType.doorKnocking,
      status: OutreachStatus.pending,
    }

    // The incident this replaced: the list used to fetch every texting job from
    // Peerly on each page load, and a vendor wobble took the whole dashboard
    // down with it. Nothing but our own database answers this request now, so
    // there is no vendor call left to fail — the rows come back as stored.
    it('returns the stored rows with no vendor call in the request', async () => {
      mockOutreachService.findByCampaignId.mockResolvedValue([
        p2pRow,
        doorKnockingRow,
      ])

      const result = await controller.findAll(baseCampaign)

      expect(result).toEqual([p2pRow, doorKnockingRow])
      expect(mockOutreachService.findByCampaignId).toHaveBeenCalledWith(
        baseCampaign.id,
      )
    })
  })
})
