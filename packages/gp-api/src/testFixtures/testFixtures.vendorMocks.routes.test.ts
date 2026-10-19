import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutreachType, UserRole, VendorMockVendor } from '@/generated/prisma'
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

describe('POST /v1/test-fixtures/vendor-mocks/jobs/:name/run', () => {
  beforeEach(async () => {
    envNonProd.value = true
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'qa-00000000-0000-0000-0000-000000000000@goodparty.org' },
    })
  })

  it('returns 404 for an unknown job name', async () => {
    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/jobs/unknown-job/run',
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns 403 for a non-test user', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'nottest@goodparty.org' },
    })

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/jobs/robocall.staging/run',
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('returns 404 outside a non-prod deploy', async () => {
    envNonProd.value = false

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/jobs/robocall.staging/run',
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/test-fixtures/vendor-mocks/time-travel', () => {
  beforeEach(() => {
    envNonProd.value = true
  })

  const seedOutreach = async (userId: number, withRobocall = false) => {
    const campaign = await seedCampaign(userId)
    const outreach = await service.prisma.outreach.create({
      data: {
        outreachType: OutreachType.robocall,
        campaignId: campaign.id,
        date: new Date('2026-01-01T12:00:00Z'),
      },
    })
    if (withRobocall) {
      await service.prisma.outreachRobocall.create({
        data: {
          outreachId: outreach.id,
          audioKey: `audio-${outreach.id}`,
          callbackNumber: '+15551234567',
        },
      })
    }
    return { campaign, outreach }
  }

  it('sets date to now for robocall.send_due_now', async () => {
    const { outreach } = await seedOutreach(service.user.id)
    const before = new Date()

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId: outreach.id, action: 'robocall.send_due_now' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.outreachId).toBe(outreach.id)
    const date = new Date(res.data.date)
    expect(date.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(res.data.dialedAt).toBeNull()
    expect(res.data.poolFreedAt).toBeNull()
  })

  it('backdates dialedAt and poolFreedAt for robocall.dialed_48h_ago', async () => {
    const { outreach } = await seedOutreach(service.user.id, true)
    const before = new Date()

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId: outreach.id, action: 'robocall.dialed_48h_ago' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    const dialedAt = new Date(res.data.dialedAt)
    // Should be ~49h ago, so at least 48h before now
    expect(before.getTime() - dialedAt.getTime()).toBeGreaterThan(
      48 * 60 * 60 * 1000,
    )
    expect(res.data.poolFreedAt).toBe(res.data.dialedAt)
  })

  it('returns 403 when the outreach belongs to a different campaign owner', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        email: `other-${Math.random().toString(36).slice(2)}@test.goodparty.org`,
        name: 'Other',
        firstName: 'Other',
        lastName: 'User',
      },
    })
    const { outreach } = await seedOutreach(otherUser.id)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId: outreach.id, action: 'robocall.send_due_now' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('returns 404 for a missing outreach', async () => {
    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId: 999999, action: 'robocall.send_due_now' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns 404 outside a non-prod deploy', async () => {
    envNonProd.value = false
    const { outreach } = await seedOutreach(service.user.id)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId: outreach.id, action: 'robocall.send_due_now' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
