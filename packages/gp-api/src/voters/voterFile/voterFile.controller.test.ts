import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { FastifyReply } from 'fastify'
import {
  Campaign,
  Organization,
  User,
  UserRole,
  VoterFileFilter,
} from '../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GetVoterFileSchema } from './schemas/GetVoterFile.schema'
import { VoterFileController } from './voterFile.controller'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

describe('VoterFileController', () => {
  let controller: VoterFileController
  let mockVoterFileService: {
    getCount: ReturnType<typeof vi.fn>
    streamCsv: ReturnType<typeof vi.fn>
  }
  let mockCampaignsService: {
    findFirstOrThrow: ReturnType<typeof vi.fn>
  }
  let mockOrganizationsService: {
    findFirstOrThrow: ReturnType<typeof vi.fn>
  }
  let mockVoterFileFilterService: {
    create: ReturnType<typeof vi.fn>
    filterAccessCheck: ReturnType<typeof vi.fn>
    findByIdAndOrganizationSlug: ReturnType<typeof vi.fn>
    findByOrganizationSlug: ReturnType<typeof vi.fn>
    updateByIdAndOrganizationSlug: ReturnType<typeof vi.fn>
    deleteByIdAndOrganizationSlug: ReturnType<typeof vi.fn>
  }

  const baseOrg = { slug: 'campaign-1' } as Organization

  const mockFilter = {
    id: 1,
    name: 'Test Filter',
  } as VoterFileFilter

  beforeEach(() => {
    mockVoterFileService = {
      getCount: vi.fn().mockResolvedValue(42),
      streamCsv: vi.fn().mockResolvedValue(undefined),
    }
    mockCampaignsService = {
      findFirstOrThrow: vi.fn(),
    }
    mockOrganizationsService = {
      findFirstOrThrow: vi.fn().mockResolvedValue(baseOrg),
    }
    mockVoterFileFilterService = {
      create: vi.fn().mockResolvedValue(mockFilter),
      filterAccessCheck: vi.fn().mockResolvedValue(undefined),
      findByIdAndOrganizationSlug: vi.fn().mockResolvedValue(mockFilter),
      findByOrganizationSlug: vi.fn().mockResolvedValue([mockFilter]),
      updateByIdAndOrganizationSlug: vi.fn().mockResolvedValue(mockFilter),
      deleteByIdAndOrganizationSlug: vi.fn().mockResolvedValue(mockFilter),
    }

    controller = new VoterFileController(
      mockVoterFileService as never,
      mockCampaignsService as never,
      mockVoterFileFilterService as never,
      // Only reached when a request carries a boundary; these cases don't.
      { resolveGeoMemberIds: vi.fn() } as never,
      mockOrganizationsService as never,
      createMockLogger(),
    )
  })

  describe('getVoterFile', () => {
    const user = { id: 1, roles: [] } as unknown as User
    const campaign = {
      id: 1,
      slug: 'campaign-1',
      organizationSlug: 'campaign-1',
    } as Campaign
    const makeRes = () => ({ send: vi.fn() }) as unknown as FastifyReply

    it('forbids a non-admin requesting another campaign by slug', async () => {
      await expect(
        controller.getVoterFile(
          user,
          campaign,
          { slug: 'someone-else', type: 'full' } as GetVoterFileSchema,
          makeRes(),
        ),
      ).rejects.toThrow(ForbiddenException)
    })

    it('lets an admin resolve another campaign by slug', async () => {
      const admin = { id: 2, roles: [UserRole.admin] } as unknown as User
      mockCampaignsService.findFirstOrThrow.mockResolvedValue({
        ...campaign,
        slug: 'someone-else',
        organizationSlug: 'someone-else',
      })
      const res = makeRes()

      await controller.getVoterFile(
        admin,
        campaign,
        { slug: 'someone-else', type: 'full', countOnly: true } as never,
        res,
      )

      expect(mockCampaignsService.findFirstOrThrow).toHaveBeenCalledWith({
        where: { slug: 'someone-else' },
      })
      expect(mockOrganizationsService.findFirstOrThrow).toHaveBeenCalledWith({
        where: { slug: 'someone-else' },
      })
    })

    it('404s when the request resolves no campaign', async () => {
      await expect(
        controller.getVoterFile(
          user,
          undefined as never,
          { type: 'full' } as GetVoterFileSchema,
          makeRes(),
        ),
      ).rejects.toThrow(NotFoundException)
    })

    it('sends the people-api count on countOnly', async () => {
      const res = makeRes()

      await controller.getVoterFile(
        user,
        campaign,
        { type: 'full', countOnly: true } as GetVoterFileSchema,
        res,
      )

      expect(mockVoterFileService.getCount).toHaveBeenCalledWith(baseOrg, {
        type: 'full',
        countOnly: true,
      })
      expect(res.send).toHaveBeenCalledWith(42)
    })

    it('streams the CSV when countOnly is not set', async () => {
      const res = makeRes()

      await controller.getVoterFile(
        user,
        campaign,
        { type: 'sms' } as GetVoterFileSchema,
        res,
      )

      expect(mockVoterFileService.streamCsv).toHaveBeenCalledWith(
        baseOrg,
        { type: 'sms' },
        res,
      )
      expect(res.send).not.toHaveBeenCalled()
    })
  })

  describe('createVoterFileFilter', () => {
    // Not Pro-gated (outreach-pro-gating-v2): create never calls
    // filterAccessCheck, unlike update/delete below.
    it('creates a filter without checking Pro access', async () => {
      const body = { name: 'My Filter' } as never

      const result = await controller.createVoterFileFilter(baseOrg, body)

      expect(
        mockVoterFileFilterService.filterAccessCheck,
      ).not.toHaveBeenCalled()
      // The third argument is the people a drawn boundary enclosed, resolved
      // by the controller. A body with no geoPoly resolves nothing.
      expect(mockVoterFileFilterService.create).toHaveBeenCalledWith(
        baseOrg.slug,
        body,
        null,
      )
      expect(result).toEqual(mockFilter)
    })
  })

  describe('listVoterFileFilters', () => {
    it('lists filters by organization slug', async () => {
      const result = controller.listVoterFileFilters(baseOrg)

      expect(
        mockVoterFileFilterService.findByOrganizationSlug,
      ).toHaveBeenCalledWith(baseOrg.slug)
      await expect(result).resolves.toEqual([mockFilter])
    })
  })

  describe('getVoterFileFilter', () => {
    it('gets filter by organization slug', async () => {
      const result = await controller.getVoterFileFilter(1, baseOrg)

      expect(
        mockVoterFileFilterService.findByIdAndOrganizationSlug,
      ).toHaveBeenCalledWith(1, baseOrg.slug)
      expect(result).toEqual(mockFilter)
    })

    it('throws NotFoundException when filter not found', async () => {
      mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
        null,
      )

      await expect(controller.getVoterFileFilter(1, baseOrg)).rejects.toThrow(
        'Voter file filter not found',
      )
    })
  })

  describe('updateVoterFileFilter', () => {
    it('throws when filterAccessCheck rejects', async () => {
      mockVoterFileFilterService.filterAccessCheck.mockRejectedValue(
        new ForbiddenException('Campaign is not pro'),
      )
      const body = { name: 'Updated Filter' } as never

      await expect(
        controller.updateVoterFileFilter(1, body, baseOrg),
      ).rejects.toThrow('Campaign is not pro')
    })

    it('updates filter when access check passes', async () => {
      const body = { name: 'Updated Filter' } as never

      const result = await controller.updateVoterFileFilter(1, body, baseOrg)

      expect(mockVoterFileFilterService.filterAccessCheck).toHaveBeenCalledWith(
        baseOrg.slug,
      )
      expect(
        mockVoterFileFilterService.findByIdAndOrganizationSlug,
      ).toHaveBeenCalledWith(1, baseOrg.slug)
      expect(
        mockVoterFileFilterService.updateByIdAndOrganizationSlug,
      ).toHaveBeenCalledWith(1, baseOrg.slug, body, null)
      expect(result).toEqual(mockFilter)
    })

    it('throws NotFoundException when filter not found', async () => {
      mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
        null,
      )
      const body = { name: 'Updated Filter' } as never

      await expect(
        controller.updateVoterFileFilter(1, body, baseOrg),
      ).rejects.toThrow('Voter file filter not found')
    })
  })

  describe('deleteVoterFileFilter', () => {
    it('deletes filter when access check passes', async () => {
      await controller.deleteVoterFileFilter(1, baseOrg)

      expect(mockVoterFileFilterService.filterAccessCheck).toHaveBeenCalledWith(
        baseOrg.slug,
      )
      expect(
        mockVoterFileFilterService.deleteByIdAndOrganizationSlug,
      ).toHaveBeenCalledWith(1, baseOrg.slug)
    })

    it('throws when filterAccessCheck rejects', async () => {
      mockVoterFileFilterService.filterAccessCheck.mockRejectedValue(
        new ForbiddenException('Campaign is not pro'),
      )

      await expect(
        controller.deleteVoterFileFilter(1, baseOrg),
      ).rejects.toThrow('Campaign is not pro')

      expect(
        mockVoterFileFilterService.deleteByIdAndOrganizationSlug,
      ).not.toHaveBeenCalled()
    })
  })
})
