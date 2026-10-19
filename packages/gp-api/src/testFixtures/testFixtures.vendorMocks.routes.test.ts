import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UserRole, VendorMockVendor } from '@/generated/prisma'
import { useTestService } from '@/test-service'

const { envNonProd } = vi.hoisted(() => ({ envNonProd: { value: true } }))
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return envNonProd.value
    },
  }
})

const service = useTestService()

const seedCampaign = async (userId: number) => {
  const slug = `test-campaign-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: userId },
  })
  return service.prisma.campaign.create({
    data: { userId, slug, organizationSlug: slug },
  })
}

const seedRecord = (
  vendor: VendorMockVendor,
  kind: string,
  externalId: string,
  state: object,
  campaignId?: number,
) =>
  service.prisma.vendorMockRecord.create({
    data: { vendor, kind, externalId, state, campaignId },
  })

describe('POST /v1/test-fixtures/vendor-mocks/actions', () => {
  beforeEach(() => {
    envNonProd.value = true
  })

  it("arms a route failure scoped to the caller's campaign", async () => {
    const campaign = await seedCampaign(service.user.id)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId: campaign.id, action: 'geoapify.route.fail' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.records).toEqual([
      expect.objectContaining({
        kind: 'route_fail',
        externalId: String(campaign.id),
        campaignId: campaign.id,
        state: { routeFail: true },
      }),
    ])
  })

  it('returns 403 when the campaign belongs to a different user', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        email: `other-${Math.random().toString(36).slice(2)}@test.goodparty.org`,
        name: 'Other',
        firstName: 'Other',
        lastName: 'User',
      },
    })
    const campaign = await seedCampaign(otherUser.id)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId: campaign.id, action: 'geoapify.route.fail' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('returns 404 outside a non-prod deploy', async () => {
    envNonProd.value = false
    const campaign = await seedCampaign(service.user.id)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId: campaign.id, action: 'geoapify.route.fail' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('GET /v1/test-fixtures/vendor-mocks/records', () => {
  beforeEach(() => {
    envNonProd.value = true
  })

  it('returns records for a campaign owned by the caller', async () => {
    const campaign = await seedCampaign(service.user.id)
    await seedRecord(
      VendorMockVendor.geoapify,
      'routeplanner_request',
      'r-1',
      { status: 'ok' },
      campaign.id,
    )
    await seedRecord(
      VendorMockVendor.geoapify,
      'routeplanner_request',
      'r-2',
      { status: 'ok' },
      campaign.id,
    )

    const res = await service.client.get(
      '/v1/test-fixtures/vendor-mocks/records',
      { params: { campaignId: campaign.id }, validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.vendorMode).toBe('mock')
    expect(res.data.records).toHaveLength(2)
    expect(
      res.data.records.every(
        (r: { externalId: string }) =>
          r.externalId === 'r-1' || r.externalId === 'r-2',
      ),
    ).toBe(true)
  })

  it('returns 403 when the campaign belongs to a different user', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        email: `other-${Math.random().toString(36).slice(2)}@test.goodparty.org`,
        name: 'Other',
        firstName: 'Other',
        lastName: 'User',
      },
    })
    const campaign = await seedCampaign(otherUser.id)

    const res = await service.client.get(
      '/v1/test-fixtures/vendor-mocks/records',
      { params: { campaignId: campaign.id }, validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('returns 404 outside a non-prod deploy', async () => {
    envNonProd.value = false
    const campaign = await seedCampaign(service.user.id)

    const res = await service.client.get(
      '/v1/test-fixtures/vendor-mocks/records',
      { params: { campaignId: campaign.id }, validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/test-fixtures/jobs/:name/run', () => {
  beforeEach(async () => {
    envNonProd.value = true
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })
  })

  it('returns 404 for any job name (M1 allowlist is empty)', async () => {
    const res = await service.client.post(
      '/v1/test-fixtures/jobs/some-job/run',
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('404s outside a non-prod deploy', async () => {
    envNonProd.value = false

    const res = await service.client.post(
      '/v1/test-fixtures/jobs/any-job/run',
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
