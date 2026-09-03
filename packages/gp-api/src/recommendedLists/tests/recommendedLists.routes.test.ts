import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import type { Recommendation } from '../services/recommendedLists.service'
import { RecommendedListsService } from '../services/recommendedLists.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

const seedWinOrg = async (slug: string) => {
  await service.prisma.organization.create({
    data: {
      slug,
      ownerId: service.user.id,
      overrideDistrictId: randomUUID(),
    },
  })
  await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${slug}-campaign`,
      organizationSlug: slug,
      isPro: true,
    },
  })
}

const seedEoOrg = (slug: string) =>
  service.prisma.organization.create({
    data: {
      slug,
      ownerId: service.user.id,
      overrideDistrictId: randomUUID(),
    },
  })

const mockRecommend = (result: Recommendation[]) =>
  vi
    .spyOn(service.app.get(RecommendedListsService), 'recommend')
    .mockResolvedValue(result)

const getRecommendedLists = (
  slug: string,
  query: { channel?: string; intent?: string },
) =>
  service.client.get('/v1/campaigns/mine/recommended-lists', {
    headers: { [ORG_SLUG_HEADER]: slug },
    params: query,
  })

const sampleRecommendation: Recommendation = {
  variant: 'persuadeAffinity',
  filter: { voterStatus: ['Super', 'Likely'], independentAffinity: true },
  count: 4_200,
  districtShare: 0.12,
  copy: {
    title: 'Persuadable independent-leaning voters',
    criteriaSummary: 'Moderate to high propensity voters who lean independent.',
  },
  existingFilterId: null,
}

describe('GET /v1/campaigns/mine/recommended-lists', () => {
  it('returns recommendations for a valid channel and intent', async () => {
    const slug = `win-${Date.now()}-happy`
    await seedWinOrg(slug)
    mockRecommend([sampleRecommendation])

    const res = await getRecommendedLists(slug, {
      channel: 'sms',
      intent: 'persuade',
    })

    expect(res.status).toBe(200)
    // Exact equality, not toMatchObject: a passing match here must not
    // tolerate an extra key the schema doesn't declare (e.g. a stray
    // estimatedCost would sneak past a partial match).
    expect(res.data).toEqual([sampleRecommendation])
  })

  it('rejects an unknown channel', async () => {
    const slug = `win-${Date.now()}-badchannel`
    await seedWinOrg(slug)
    mockRecommend([sampleRecommendation])

    const res = await getRecommendedLists(slug, {
      channel: 'carrierPigeon',
      intent: 'persuade',
    })

    expect(res.status).toBe(400)
  })

  it('rejects an unknown intent', async () => {
    const slug = `win-${Date.now()}-badintent`
    await seedWinOrg(slug)
    mockRecommend([sampleRecommendation])

    const res = await getRecommendedLists(slug, {
      channel: 'sms',
      intent: 'flirt',
    })

    expect(res.status).toBe(400)
  })

  it('refuses an elected-official org before calling the service', async () => {
    const slug = `eo-${Date.now()}`
    await seedEoOrg(slug)
    const recommend = mockRecommend([sampleRecommendation])

    const res = await getRecommendedLists(slug, {
      channel: 'sms',
      intent: 'persuade',
    })

    expect(res.status).toBe(400)
    // The mutation this guards: an eo- gate that only threw AFTER calling
    // the service would still 400, but would have already paid for (and
    // leaked into) the Win-only resolution the service backstop exists to
    // prevent. This call count is what proves the refusal happens first.
    expect(recommend).not.toHaveBeenCalled()
  })

  it('persists nothing', async () => {
    const slug = `win-${Date.now()}-nowrite`
    await seedWinOrg(slug)
    mockRecommend([sampleRecommendation])

    const before = await service.prisma.voterFileFilter.count()
    const res = await getRecommendedLists(slug, {
      channel: 'sms',
      intent: 'persuade',
    })

    expect(res.status).toBe(200)
    expect(await service.prisma.voterFileFilter.count()).toBe(before)
  })

  it('returns [] rather than an error when nothing qualifies', async () => {
    const slug = `win-${Date.now()}-empty`
    await seedWinOrg(slug)
    mockRecommend([])

    const res = await getRecommendedLists(slug, {
      channel: 'sms',
      intent: 'event',
    })

    expect(res.status).toBe(200)
    expect(res.data).toEqual([])
  })
})
