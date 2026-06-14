import { ExecutionContext } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Campaign, Organization } from '../../../generated/prisma'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { OrganizationsService } from 'src/organizations/services/organizations.service'
import { VoterFileDownloadAccessService } from '../../../shared/services/voterFileDownloadAccess.service'
import { CanDownloadVoterFileGuard } from './CanDownloadVoterFile.guard'

const orgA = { slug: 'campaign-a', ownerId: 1 } as Organization
const campaignA = {
  id: 10,
  organizationSlug: 'campaign-a',
  userId: 1,
} as Campaign

describe('CanDownloadVoterFileGuard', () => {
  let guard: CanDownloadVoterFileGuard
  let campaignsService: CampaignsService
  let organizationsService: OrganizationsService
  let voterFileDownloadAccess: VoterFileDownloadAccessService
  let mockOrgFindFirst: ReturnType<typeof vi.fn>

  function buildContext(
    headers: Record<string, string> = {},
  ): ExecutionContext {
    const req = { headers, user: { id: 1 } }
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext
  }

  beforeEach(() => {
    mockOrgFindFirst = vi.fn()
    campaignsService = {
      findFirst: vi.fn(),
      client: { organization: { findFirst: mockOrgFindFirst } },
    } as unknown as CampaignsService
    organizationsService = {
      getDistrictAndBallotLevelForOrgSlug: vi
        .fn()
        .mockResolvedValue({ district: null, ballotLevel: null }),
    } as unknown as OrganizationsService
    voterFileDownloadAccess = {
      canDownload: vi.fn().mockReturnValue(true),
    } as unknown as VoterFileDownloadAccessService

    guard = new CanDownloadVoterFileGuard(
      campaignsService,
      voterFileDownloadAccess,
      organizationsService,
    )
  })

  it('authorizes the campaign of the org the user is acting in', async () => {
    mockOrgFindFirst.mockResolvedValue(orgA)
    vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(campaignA)

    const result = await guard.canActivate(
      buildContext({ 'x-organization-slug': 'campaign-a' }),
    )

    expect(result).toBe(true)
    expect(mockOrgFindFirst).toHaveBeenCalledWith({
      where: { slug: 'campaign-a', ownerId: 1 },
    })
    expect(campaignsService.findFirst).toHaveBeenCalledWith({
      where: { organizationSlug: 'campaign-a', userId: 1 },
    })
    expect(
      organizationsService.getDistrictAndBallotLevelForOrgSlug,
    ).toHaveBeenCalledWith('campaign-a')
    expect(voterFileDownloadAccess.canDownload).toHaveBeenCalledWith(
      campaignA,
      null,
      null,
    )
  })

  it('denies when acting in an org the user does not own', async () => {
    // org belongs to another user, so the { slug, ownerId } lookup misses
    mockOrgFindFirst.mockResolvedValue(null)
    vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(null)

    const result = await guard.canActivate(
      buildContext({ 'x-organization-slug': 'campaign-b' }),
    )

    expect(result).toBe(false)
    expect(voterFileDownloadAccess.canDownload).not.toHaveBeenCalled()
  })

  it('denies when no org slug header is present', async () => {
    const result = await guard.canActivate(buildContext())

    expect(result).toBe(false)
    expect(mockOrgFindFirst).not.toHaveBeenCalled()
    expect(voterFileDownloadAccess.canDownload).not.toHaveBeenCalled()
  })

  it('denies when the owned campaign is not eligible for download', async () => {
    mockOrgFindFirst.mockResolvedValue(orgA)
    vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(campaignA)
    vi.spyOn(voterFileDownloadAccess, 'canDownload').mockReturnValue(false)

    const result = await guard.canActivate(
      buildContext({ 'x-organization-slug': 'campaign-a' }),
    )

    expect(result).toBe(false)
  })
})
