import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import type { FastifyReply } from 'fastify'
import { ContactsService } from '@/contacts/services/contacts.service'
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
  query: { channel?: string; intent?: string; variant?: string },
) =>
  service.client.get('/v1/campaigns/mine/recommended-lists', {
    headers: { [ORG_SLUG_HEADER]: slug },
    params: query,
  })

const sampleRecommendation: Recommendation = {
  variant: 'persuadeAffinity',
  intent: 'persuade',
  filter: { voterStatus: ['Super', 'Likely'], independentAffinity: true },
  count: 4_200,
  voteGoalShare: 1.05,
  estimatedCostCents: 14_700,
  copy: {
    title: 'Persuadable independent-leaning voters',
    criteriaSummary: 'Moderate to high propensity voters who lean independent.',
  },
  existingFilterId: null,
}

// The voter data page's details sheet downloads a recommendation the
// candidate has not saved: the route resolves the variant's global universe
// and streams it through the same CSV path a saved list takes.
describe('GET /v1/campaigns/mine/recommended-lists/:variant/download', () => {
  const GLOBAL_FILTER = {
    voterStatus: ['Super', 'Likely'],
    independentAffinity: true,
  }

  const download = (slug: string, variant: string) =>
    service.client.get(
      `/v1/campaigns/mine/recommended-lists/${variant}/download`,
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

  it('streams the variant universe as a CSV', async () => {
    const slug = `win-${Date.now()}-dl`
    await seedWinOrg(slug)
    vi.spyOn(
      service.app.get(RecommendedListsService),
      'globalFilterFor',
    ).mockResolvedValue(GLOBAL_FILTER)
    const downloadFilter = vi
      .spyOn(service.app.get(ContactsService), 'downloadFilter')
      .mockImplementation(async (_filter, res: FastifyReply) => {
        res.type('text/csv').send('first,last\n')
      })

    const res = await download(slug, 'persuadeAffinity')

    expect(res.status).toBe(200)
    expect(res.data).toBe('first,last\n')
    expect(downloadFilter).toHaveBeenCalledWith(
      GLOBAL_FILTER,
      expect.anything(),
      expect.objectContaining({ slug }),
    )
  })

  it('404s a variant that resolves to no universe for this campaign', async () => {
    const slug = `win-${Date.now()}-dl404`
    await seedWinOrg(slug)
    vi.spyOn(
      service.app.get(RecommendedListsService),
      'globalFilterFor',
    ).mockResolvedValue(null)
    const downloadFilter = vi.spyOn(
      service.app.get(ContactsService),
      'downloadFilter',
    )

    const res = await download(slug, 'persuadeIdeology')

    expect(res.status).toBe(404)
    expect(downloadFilter).not.toHaveBeenCalled()
  })

  it('rejects an unknown variant', async () => {
    const slug = `win-${Date.now()}-dlbad`
    await seedWinOrg(slug)

    const res = await download(slug, 'everyoneEver')

    expect(res.status).toBe(400)
  })

  it('refuses an elected-official org before resolving anything', async () => {
    const slug = `eo-${Date.now()}-dl`
    await seedEoOrg(slug)
    const globalFilterFor = vi.spyOn(
      service.app.get(RecommendedListsService),
      'globalFilterFor',
    )

    const res = await download(slug, 'persuadeAffinity')

    expect(res.status).toBe(400)
    expect(globalFilterFor).not.toHaveBeenCalled()
  })
})

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
    // Exact equality, not toMatchObject: the response schema strips keys it
    // doesn't declare, so a partial match would stay green while a field
    // the card needs was being silently dropped on the way out. The sample
    // carries a share above 1 on purpose — a list can hold more people than
    // the race needs votes, and a `.max(1)` on the schema would turn every
    // such response into a 500.
    expect(res.data).toEqual([sampleRecommendation])
  })

  // The response schema is only worth having if it actually rejects. Zod's
  // `z.object()` strips unknown keys rather than failing, so a "the guard
  // works" test written against an extra key would pass no matter what —
  // this uses a declared field with a violated constraint instead.
  it('refuses to serve a negative estimated cost', async () => {
    const slug = `win-${Date.now()}-badcost`
    await seedWinOrg(slug)
    mockRecommend([{ ...sampleRecommendation, estimatedCostCents: -1 }])

    const res = await getRecommendedLists(slug, {
      channel: 'sms',
      intent: 'persuade',
    })

    expect(res.status).toBe(500)
  })

  // The voter data page's request: no channel at all.
  it('serves the global universes when no channel is given', async () => {
    const slug = `win-${Date.now()}-global`
    await seedWinOrg(slug)
    const recommend = mockRecommend([sampleRecommendation])

    const res = await getRecommendedLists(slug, {})

    expect(res.status).toBe(200)
    expect(res.data).toEqual([sampleRecommendation])
    expect(recommend).toHaveBeenCalledWith(
      expect.objectContaining({ slug }),
      expect.anything(),
      null,
      null,
      null,
    )
  })

  it('passes a requested variant through to the service', async () => {
    const slug = `win-${Date.now()}-variant`
    await seedWinOrg(slug)
    const recommend = mockRecommend([sampleRecommendation])

    const res = await getRecommendedLists(slug, {
      channel: 'sms',
      variant: 'persuadeAffinity',
    })

    expect(res.status).toBe(200)
    expect(recommend).toHaveBeenCalledWith(
      expect.objectContaining({ slug }),
      expect.anything(),
      'sms',
      null,
      'persuadeAffinity',
    )
  })

  it('rejects an unknown variant', async () => {
    const slug = `win-${Date.now()}-badvariant`
    await seedWinOrg(slug)
    mockRecommend([sampleRecommendation])

    const res = await getRecommendedLists(slug, {
      channel: 'sms',
      variant: 'everyoneEver',
    })

    expect(res.status).toBe(400)
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
