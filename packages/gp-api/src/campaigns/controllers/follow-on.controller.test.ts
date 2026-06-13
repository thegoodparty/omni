import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { CrmCampaignsService } from '../services/crmCampaigns.service'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = useTestService()

describe('POST /v1/campaigns/follow-on', () => {
  beforeEach(() => {
    // createForUser fires a CRM sync that resolves the new org's position and
    // district via the election-api, which isn't reachable in the harness.
    // That sync is incidental to the follow-on behavior under test, so stub it.
    const crm = service.app.get(CrmCampaignsService)
    vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)
  })

  it('inherits the held office position and carries isPro on a same-office run', async () => {
    // Previous (won) campaign that earned the office, carrying Pro.
    await service.prisma.organization.create({
      data: { slug: 'campaign-50', ownerId: service.user.id },
    })
    const prevCampaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'prev-run',
        isPro: true,
        didWin: true,
        details: { electionDate: '2099-11-03' },
        organizationSlug: 'campaign-50',
      },
    })

    // The held-office org carries the position to inherit.
    await service.prisma.organization.create({
      data: {
        slug: 'eo-source',
        ownerId: service.user.id,
        positionId: 'pos-source',
        overrideDistrictId: 'district-source',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-source',
        userId: service.user.id,
        isActive: true,
        termEndAt: null,
        campaignId: prevCampaign.id,
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-source',
      details: { electionDate: '2099-11-03', state: 'CA' },
    })

    expect(result.status).toBe(201)
    expect(result.data).toMatchObject({ isPro: true, didWin: null })

    const newOrg = await service.prisma.organization.findUnique({
      where: { slug: `campaign-${result.data.id}` },
    })
    expect(newOrg).toMatchObject({
      positionId: 'pos-source',
      overrideDistrictId: 'district-source',
      ownerId: service.user.id,
    })
  })

  it('returns 409 when the user already has an active campaign', async () => {
    await service.prisma.organization.create({
      data: { slug: 'campaign-60', ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'active-run',
        details: { electionDate: '2099-11-03' },
        organizationSlug: 'campaign-60',
      },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'eo-source-2',
        ownerId: service.user.id,
        positionId: 'pos-source-2',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-source-2',
        userId: service.user.id,
        isActive: true,
        termEndAt: null,
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-source-2',
      details: { electionDate: '2099-11-03', state: 'CA' },
    })

    expect(result.status).toBe(409)
  })

  it('returns 404 and creates nothing when fromOrganizationSlug belongs to another user', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        id: 456,
        clerkId: 'user_other_456',
        email: 'other@goodparty.org',
        firstName: 'Other',
        lastName: 'User',
      },
    })
    await service.prisma.organization.create({
      data: {
        slug: 'eo-not-mine',
        ownerId: otherUser.id,
        positionId: 'pos-not-mine',
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-not-mine',
      details: { electionDate: '2099-11-03', state: 'CA' },
    })

    expect(result.status).toBe(404)

    const campaignCount = await service.prisma.campaign.count({
      where: { userId: service.user.id },
    })
    expect(campaignCount).toBe(0)
  })

  it('creates a campaign from the body position on a new-office run', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionByBallotReadyId').mockResolvedValue({
      id: 'pos-new',
      brPositionId: 'br-new',
      brDatabaseId: 'db-new',
      state: 'CA',
      name: 'City Council',
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'new-office',
      ballotReadyPositionId: 'br-new',
      details: { electionDate: '2099-11-03', state: 'CA' },
    })

    expect(result.status).toBe(201)

    const newOrg = await service.prisma.organization.findUnique({
      where: { slug: `campaign-${result.data.id}` },
    })
    expect(newOrg).toMatchObject({
      positionId: 'pos-new',
      ownerId: service.user.id,
    })
  })
})
