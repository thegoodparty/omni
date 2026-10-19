import { useTestService } from '@/test-service'
import { beforeEach, describe, expect, it } from 'vitest'

const service = useTestService()

// The support estimate is now sourced from election-api over HTTP, so the
// happy-path mapping is covered hermetically by the unit tests
// (supportEstimate.service.test.ts + electedOfficeSupportApi.service.test.ts).
// Here we only assert the route's auth gate, which never reaches election-api.
describe('GET /v1/elected-office/support-estimate (integration)', () => {
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

  it('returns 404 when the org header is missing', async () => {
    const result = await service.client.get(
      '/v1/elected-office/support-estimate',
    )

    expect(result.status).toBe(404)
  })
})
