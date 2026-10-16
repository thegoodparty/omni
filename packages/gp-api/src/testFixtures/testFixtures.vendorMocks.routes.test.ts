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

const makeAdmin = () =>
  service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })

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
  beforeEach(async () => {
    envNonProd.value = true
    await makeAdmin()
  })

  it('sets routeFail on the geoapify record and returns records', async () => {
    const campaignId = 1
    await seedRecord(
      VendorMockVendor.geoapify,
      'routing_request',
      'ext-1',
      { status: 'ok' },
      campaignId,
    )

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId, action: 'geoapify.route.fail' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.records).toHaveLength(1)
    const record = res.data.records[0]
    expect(record.externalId).toBe('ext-1')
    expect(record.state).toMatchObject({ routeFail: true })
  })

  it('creates a sentinel record when no geoapify record exists', async () => {
    const campaignId = 2

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId, action: 'geoapify.route.fail' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    const sentinel = res.data.records.find(
      (r: { externalId: string }) => r.externalId === 'sentinel',
    )
    expect(sentinel?.state).toMatchObject({ routeFail: true })
  })

  it('returns 400 for an unknown action', async () => {
    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId: 1, action: 'unknown.action' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('404s outside a non-prod deploy', async () => {
    envNonProd.value = false

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId: 1, action: 'geoapify.route.fail' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('turns away a non-admin caller', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [] },
    })

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId: 1, action: 'geoapify.route.fail' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })
})

describe('GET /v1/test-fixtures/vendor-mocks/records', () => {
  beforeEach(async () => {
    envNonProd.value = true
    await makeAdmin()
  })

  it('returns records scoped to campaignId', async () => {
    await seedRecord(
      VendorMockVendor.geoapify,
      'routing_request',
      'r-1',
      { status: 'ok' },
      10,
    )
    await seedRecord(
      VendorMockVendor.geoapify,
      'routing_request',
      'r-2',
      { status: 'ok' },
      10,
    )
    await seedRecord(
      VendorMockVendor.geoapify,
      'routing_request',
      'r-other',
      { status: 'ok' },
      20,
    )

    const res = await service.client.get(
      '/v1/test-fixtures/vendor-mocks/records',
      { params: { campaignId: 10 }, validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.records).toHaveLength(2)
    expect(
      res.data.records.every(
        (r: { vendor: string; externalId: string }) =>
          r.vendor === 'geoapify' &&
          (r.externalId === 'r-1' || r.externalId === 'r-2'),
      ),
    ).toBe(true)
  })

  it('returns an empty list when no records exist for the campaign', async () => {
    const res = await service.client.get(
      '/v1/test-fixtures/vendor-mocks/records',
      { params: { campaignId: 999 }, validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.records).toEqual([])
  })

  it('404s outside a non-prod deploy', async () => {
    envNonProd.value = false

    const res = await service.client.get(
      '/v1/test-fixtures/vendor-mocks/records',
      { params: { campaignId: 1 }, validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/test-fixtures/jobs/:name/run', () => {
  beforeEach(async () => {
    envNonProd.value = true
    await makeAdmin()
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
