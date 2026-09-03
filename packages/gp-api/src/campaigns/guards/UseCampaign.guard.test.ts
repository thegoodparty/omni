import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ExecutionContext, NotFoundException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Campaign, OrganizationRole } from '../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizationMembershipService } from '@/organizations/services/organizationMembership.service'
import { RequireCampaignMetadata } from '../decorators/UseCampaign.decorator'
import { CampaignsService } from '../services/campaigns.service'
import { UseCampaignGuard } from './UseCampaign.guard'

const mockCampaign = { id: 10, organizationSlug: 'campaign-100' } as Campaign

describe('UseCampaignGuard', () => {
  let guard: UseCampaignGuard
  let campaignsService: CampaignsService
  let organizationMembership: OrganizationMembershipService
  let reflector: Reflector

  function buildContext(
    headers: Record<string, string> = {},
    userId = 1,
  ): ExecutionContext {
    const req = { headers, user: { id: userId }, campaign: undefined }
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext
  }

  function mockMetadata(meta: RequireCampaignMetadata = {}) {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(meta)
  }

  beforeEach(() => {
    campaignsService = { findFirst: vi.fn() } as unknown as CampaignsService
    organizationMembership = {
      resolveRole: vi.fn(),
    } as unknown as OrganizationMembershipService
    reflector = {
      getAllAndOverride: vi.fn().mockReturnValue({}),
    } as unknown as Reflector

    guard = new UseCampaignGuard(
      campaignsService,
      organizationMembership,
      reflector,
      createMockLogger(),
    )
  })

  it('attaches the campaign and owner role once role resolution succeeds', async () => {
    mockMetadata()
    vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue({
      role: OrganizationRole.owner,
      organization: { slug: 'campaign-100', ownerId: 1 } as never,
    })
    vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(mockCampaign)

    const ctx = buildContext({ 'x-organization-slug': 'campaign-100' })
    const result = await guard.canActivate(ctx)

    expect(result).toBe(true)
    // The campaign lookup keys on organizationSlug alone — a member's
    // userId is never Campaign.userId, so any userId predicate here would
    // 404 every campaign-scoped route for a member.
    expect(campaignsService.findFirst).toHaveBeenCalledWith({
      where: { organizationSlug: 'campaign-100' },
      include: {},
    })
    const req = ctx.switchToHttp().getRequest() as {
      campaign?: Campaign
      organizationRole?: OrganizationRole
    }
    expect(req.campaign).toEqual(mockCampaign)
    expect(req.organizationRole).toBe(OrganizationRole.owner)
  })

  it('passes a custom include through to the campaign lookup', async () => {
    const include = { organization: true, user: true }
    mockMetadata({ include })
    vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue({
      role: OrganizationRole.owner,
      organization: { slug: 'campaign-100', ownerId: 1 } as never,
    })
    vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(mockCampaign)

    const ctx = buildContext({ 'x-organization-slug': 'campaign-100' })
    await guard.canActivate(ctx)

    expect(campaignsService.findFirst).toHaveBeenCalledWith({
      where: { organizationSlug: 'campaign-100' },
      include: { organization: true, user: true },
    })
  })

  it('admits a campaignAdmin member and attaches their role', async () => {
    mockMetadata()
    vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue({
      role: OrganizationRole.campaignAdmin,
      organization: { slug: 'campaign-100', ownerId: 1 } as never,
    })
    vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(mockCampaign)

    const ctx = buildContext({ 'x-organization-slug': 'campaign-100' }, 2)
    const result = await guard.canActivate(ctx)

    expect(result).toBe(true)
    expect(organizationMembership.resolveRole).toHaveBeenCalledWith(
      'campaign-100',
      2,
    )
    const req = ctx.switchToHttp().getRequest() as {
      organizationRole?: OrganizationRole
    }
    expect(req.organizationRole).toBe(OrganizationRole.campaignAdmin)
  })

  it('throws NotFoundException when role resolution fails (non-member)', async () => {
    mockMetadata()
    vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue(null)

    const ctx = buildContext({ 'x-organization-slug': 'campaign-100' })

    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException)
    expect(campaignsService.findFirst).not.toHaveBeenCalled()
  })

  it('throws NotFoundException when role resolves but there is no campaign', async () => {
    mockMetadata()
    vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue({
      role: OrganizationRole.owner,
      organization: { slug: 'campaign-100', ownerId: 1 } as never,
    })
    vi.spyOn(campaignsService, 'findFirst').mockResolvedValue(null)

    const ctx = buildContext({ 'x-organization-slug': 'campaign-100' })

    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException)
  })

  it('returns true without a campaign when continueIfNotFound', async () => {
    mockMetadata({ continueIfNotFound: true })
    vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue(null)

    const ctx = buildContext({ 'x-organization-slug': 'nonexistent' })
    const result = await guard.canActivate(ctx)

    expect(result).toBe(true)
  })

  it('throws NotFoundException when no header is present', async () => {
    mockMetadata()

    const ctx = buildContext()

    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException)
    expect(organizationMembership.resolveRole).not.toHaveBeenCalled()
  })
})
