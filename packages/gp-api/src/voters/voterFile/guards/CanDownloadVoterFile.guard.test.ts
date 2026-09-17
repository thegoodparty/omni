import { ExecutionContext } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Campaign,
  Organization,
  OrganizationRole,
} from '../../../generated/prisma'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { OrganizationMembershipService } from 'src/organizations/services/organizationMembership.service'
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
  let organizationMembership: OrganizationMembershipService
  let voterFileDownloadAccess: VoterFileDownloadAccessService

  function buildContext(
    headers: Record<string, string> = {},
  ): ExecutionContext {
    const req = { headers, user: { id: 1 } }
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext
  }

  beforeEach(() => {
    campaignsService = { findFirst: vi.fn() } as unknown as CampaignsService
    organizationMembership = {
      resolveRole: vi.fn(),
    } as unknown as OrganizationMembershipService
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
      organizationMembership,
    )
  })

  it('authorizes the owner of the org the user is acting in', async () => {
    vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue({
      role: OrganizationRole.owner,
      organization: orgA,
    })
    vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(campaignA)

    const result = await guard.canActivate(
      buildContext({ 'x-organization-slug': 'campaign-a' }),
    )

    expect(result).toBe(true)
    expect(organizationMembership.resolveRole).toHaveBeenCalledWith(
      'campaign-a',
      1,
    )
    // The campaign lookup keys on organizationSlug alone — a member's
    // userId is never Campaign.userId.
    expect(campaignsService.findFirst).toHaveBeenCalledWith({
      where: { organizationSlug: 'campaign-a' },
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

  it('authorizes a campaignAdmin member the same as the owner', async () => {
    vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue({
      role: OrganizationRole.campaignAdmin,
      organization: orgA,
    })
    vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(campaignA)

    const result = await guard.canActivate(
      buildContext({ 'x-organization-slug': 'campaign-a' }),
    )

    expect(result).toBe(true)
    expect(voterFileDownloadAccess.canDownload).toHaveBeenCalledWith(
      campaignA,
      null,
      null,
    )
  })

  it('denies a volunteer regardless of plan eligibility', async () => {
    vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue({
      role: OrganizationRole.volunteer,
      organization: orgA,
    })

    const result = await guard.canActivate(
      buildContext({ 'x-organization-slug': 'campaign-a' }),
    )

    expect(result).toBe(false)
    // Fails closed before ever consulting plan/eligibility.
    expect(campaignsService.findFirst).not.toHaveBeenCalled()
    expect(voterFileDownloadAccess.canDownload).not.toHaveBeenCalled()
  })

  it('denies when acting in an org the user is not a member of', async () => {
    vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue(null)

    const result = await guard.canActivate(
      buildContext({ 'x-organization-slug': 'campaign-b' }),
    )

    expect(result).toBe(false)
    expect(voterFileDownloadAccess.canDownload).not.toHaveBeenCalled()
  })

  it('denies when no org slug header is present', async () => {
    const result = await guard.canActivate(buildContext())

    expect(result).toBe(false)
    expect(organizationMembership.resolveRole).not.toHaveBeenCalled()
    expect(voterFileDownloadAccess.canDownload).not.toHaveBeenCalled()
  })

  it('denies when the owned campaign is not eligible for download', async () => {
    vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue({
      role: OrganizationRole.owner,
      organization: orgA,
    })
    vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(campaignA)
    vi.spyOn(voterFileDownloadAccess, 'canDownload').mockReturnValue(false)

    const result = await guard.canActivate(
      buildContext({ 'x-organization-slug': 'campaign-a' }),
    )

    expect(result).toBe(false)
  })
})
