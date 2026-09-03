import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { CampaignTcrComplianceService } from '@/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { getActorContext } from '../impersonation-context'
import { OrganizationRole } from '../../generated/prisma'

// ENG-10825: the global ImpersonationInterceptor reads request.organizationRole
// to populate actorRole, but that property is set by a route-scoped guard
// (UseCampaignGuard) rather than a global one. These tests hit the real HTTP
// pipeline to prove guards finish resolving organizationRole before the
// interceptor's pre-handler logic runs — a unit test against the interceptor
// alone can't observe Nest's actual guard-then-interceptor ordering.
const service = useTestService()

let campaignId: number

beforeEach(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  campaignId = Math.floor(Math.random() * 1_000_000)

  const orgSlug = `actor-ctx-${suffix}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: `actor-ctx-campaign-${suffix}`,
    },
  })
})

// Stubs the DB read entirely (its result doesn't matter here) so each test
// gets a fresh implementation instead of layering on whatever the previous
// test's spy left behind.
const captureActorContext = () => {
  let captured: ReturnType<typeof getActorContext>
  const tcrService = service.app.get(CampaignTcrComplianceService)
  vi.spyOn(tcrService, 'fetchByCampaignId').mockImplementation(async () => {
    captured = getActorContext()
    return null
  })
  return () => captured
}

describe('ImpersonationInterceptor actor fields (HTTP harness)', () => {
  it('carries actorRole=owner + actorUserId for the org owner', async () => {
    const getCaptured = captureActorContext()
    const campaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    })

    const res = await service.client.get('/v1/campaigns/tcr-compliance/mine', {
      headers: { 'x-organization-slug': campaign.organizationSlug },
    })

    expect(res.status).toBe(200)
    expect(getCaptured()).toEqual({
      isImpersonating: false,
      actorUserId: service.user.id,
      actorRole: OrganizationRole.owner,
    })
  })

  it('carries actorRole=campaignAdmin + actorUserId for a membership-row member', async () => {
    const owner = await service.prisma.user.create({
      data: { email: 'actor-ctx-owner@goodparty.org' },
    })
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const orgSlug = `actor-ctx-member-${suffix}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: owner.id },
    })
    await service.prisma.campaign.create({
      data: {
        organizationSlug: orgSlug,
        userId: owner.id,
        slug: `actor-ctx-member-campaign-${suffix}`,
      },
    })
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: orgSlug,
        userId: service.user.id,
        role: OrganizationRole.campaignAdmin,
      },
    })

    const getCaptured = captureActorContext()

    const res = await service.client.get('/v1/campaigns/tcr-compliance/mine', {
      headers: { 'x-organization-slug': orgSlug },
    })

    expect(res.status).toBe(200)
    expect(getCaptured()).toEqual({
      isImpersonating: false,
      actorUserId: service.user.id,
      actorRole: OrganizationRole.campaignAdmin,
    })
  })
})
