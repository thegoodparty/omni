import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { FastifyReply } from 'fastify'
import { Campaign, Organization, User, UserRole } from '../../generated/prisma'
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

  const baseOrg = { slug: 'campaign-1' } as Organization

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

    controller = new VoterFileController(
      mockVoterFileService as never,
      mockCampaignsService as never,
      {} as never,
      // Only reached when a request carries a boundary; these cases don't.
      { resolveGeoMemberIds: vi.fn() } as never,
      mockOrganizationsService as never,
      // Only reached for a list kept to a priority's unreached area.
      { get: vi.fn() } as never,
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
})
