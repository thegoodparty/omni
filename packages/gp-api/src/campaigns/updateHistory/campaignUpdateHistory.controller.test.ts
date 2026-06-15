import { useTestService } from '@/test-service'
import { ClerkUserEnricherService } from '@/vendors/clerk/services/clerk-user-enricher.service'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = useTestService()

describe('GET /v1/campaigns/mine/update-history', () => {
  beforeEach(() => {
    // User enrichment hits Clerk and is incidental to which campaign the
    // endpoint resolves, so pass the rows through untouched.
    const enricher = service.app.get(ClerkUserEnricherService)
    vi.spyOn(enricher, 'enrichUsers').mockImplementation(async (users) => users)
  })

  const seedCampaign = async (
    slug: string,
    details: { electionDate: string },
    didWin: boolean | null,
  ) => {
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    return service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${slug}-campaign`,
        organizationSlug: slug,
        details,
        didWin,
      },
    })
  }

  it('resolves the active campaign when no slug is given, not the first', async () => {
    // Concluded campaign created first, so the old findByUserId (first row)
    // would have picked it; the active one is created second.
    const concluded = await seedCampaign(
      'campaign-1',
      { electionDate: '2099-11-03' },
      true,
    )
    const active = await seedCampaign(
      'campaign-2',
      { electionDate: '2099-11-03' },
      null,
    )

    await service.prisma.campaignUpdateHistory.create({
      data: {
        campaignId: concluded.id,
        userId: service.user.id,
        type: 'calls',
        quantity: 1,
      },
    })
    await service.prisma.campaignUpdateHistory.create({
      data: {
        campaignId: active.id,
        userId: service.user.id,
        type: 'doorKnocking',
        quantity: 2,
      },
    })

    const result = await service.client.get('/v1/campaigns/mine/update-history')

    expect(result.status).toBe(200)
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({
      campaignId: active.id,
      type: 'doorKnocking',
    })
  })

  it('returns 404 when the user has no active campaign', async () => {
    await seedCampaign('campaign-3', { electionDate: '2099-11-03' }, true)

    const result = await service.client.get('/v1/campaigns/mine/update-history')

    expect(result.status).toBe(404)
  })
})
