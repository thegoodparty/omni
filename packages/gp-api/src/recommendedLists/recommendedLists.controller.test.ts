import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import { describe, expect, it, vi } from 'vitest'

const service = useTestService()

const SLUG = 'reclists-campaign'
const ORG_SLUG_HEADER = 'X-Organization-Slug'
const PATH = '/v1/campaigns/mine/recommended-lists'
const RACE_ID = 'race-hash-1'

const seedCampaign = async (opts: { isPro: boolean; raceId?: string }) => {
  await service.prisma.organization.create({
    data: { slug: SLUG, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${SLUG}-campaign`,
      organizationSlug: SLUG,
      isPro: opts.isPro,
      ...(opts.raceId ? { details: { raceId: opts.raceId } } : {}),
    },
  })
}

describe('GET /v1/campaigns/mine/recommended-lists', () => {
  it('403s a non-Pro campaign', async () => {
    await seedCampaign({ isPro: false })

    const result = await service.client.get(PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(403)
  })

  it('reports unavailable when the Win warehouse is unconfigured', async () => {
    await seedCampaign({ isPro: true, raceId: RACE_ID })
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)

    const result = await service.client.get(PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data).toEqual({ status: 'unavailable' })
  })
})
