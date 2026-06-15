import { useTestService } from '@/test-service'
import { beforeEach, describe, expect, it } from 'vitest'

const service = useTestService()

const INTERIM_ESTIMATE = {
  likelySupport: 1240,
  districtSize: 5200,
  percentOfDistrict: 23.8,
  trendVsLastMonth: 2.1,
}

describe('GET /v1/dashboard/support-estimate (integration)', () => {
  let orgSlug: string

  beforeEach(async () => {
    orgSlug = `eo-org-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `support-estimate-campaign-${Date.now()}`,
        organizationSlug: orgSlug,
        details: {},
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        campaignId: campaign.id,
        organizationSlug: orgSlug,
      },
    })
  })

  it('returns the interim estimate for the resolved office', async () => {
    const result = await service.client.get('/v1/dashboard/support-estimate', {
      headers: { 'x-organization-slug': orgSlug },
    })

    expect(result.status).toBe(200)
    expect(result.data).toEqual(INTERIM_ESTIMATE)
  })

  it('returns 404 when the org header is missing', async () => {
    const result = await service.client.get('/v1/dashboard/support-estimate')

    expect(result.status).toBe(404)
  })
})
