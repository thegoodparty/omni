import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { VendorMockRecordService } from '../vendorMockRecord.service'
import { VendorMockVendor } from '@/generated/prisma'

// VENDOR_MODE and IS_NON_PROD_DEPLOY are module-level constants evaluated at
// import time. Use getters so they stay mutable per-test.
const { mockMode } = vi.hoisted(() => ({ mockMode: { value: 'mock' } }))
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return true
    },
    get VENDOR_MODE() {
      return mockMode.value as 'mock' | 'live'
    },
  }
})

const service = useTestService()

const ROUTEPLANNER_PATH = '/v1/vendor-mocks/geoapify/v1/routeplanner'
const ROUTING_PATH = '/v1/vendor-mocks/geoapify/v1/routing'
const API_KEY = 'test-api-key'

const scopedPath = (slug: string, api: 'routeplanner' | 'routing') =>
  `/v1/vendor-mocks/geoapify/org/${slug}/v1/${api}`

const seedCampaign = async () => {
  const slug = `mock-org-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: { userId: service.user.id, slug, organizationSlug: slug },
  })
}

const twoJobBody = {
  mode: 'walk',
  agents: [{ start_location: [-73.935242, 40.73061] }],
  jobs: [
    { id: 'job-1', location: [-73.935, 40.73] },
    { id: 'job-2', location: [-73.94, 40.732] },
  ],
}

describe('POST /v1/vendor-mocks/geoapify/v1/routeplanner', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('returns waypoints in the order jobs were submitted', async () => {
    const res = await service.client.post(
      `${ROUTEPLANNER_PATH}?apiKey=${API_KEY}`,
      twoJobBody,
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    const feature = res.data.features[0]
    const actions = feature.properties.actions as Array<{
      type: string
      job_id: string
    }>
    const jobOrder = actions
      .filter((a) => a.type === 'job')
      .map((a) => a.job_id)
    expect(jobOrder).toEqual(['job-1', 'job-2'])
  })

  it('stores a VendorMockRecord with the request body', async () => {
    await service.client.post(
      `${ROUTEPLANNER_PATH}?apiKey=${API_KEY}`,
      twoJobBody,
    )

    const svc = service.app.get(VendorMockRecordService)
    const records = await svc.findMany({
      where: {
        vendor: VendorMockVendor.geoapify,
        kind: 'routeplanner_request',
      },
    })
    expect(records.length).toBeGreaterThan(0)
    const requests = records[0]?.requests
    expect(Array.isArray(requests) && requests.length).toBeGreaterThan(0)
  })

  it('returns 400 when apiKey is missing', async () => {
    const res = await service.client.post(ROUTEPLANNER_PATH, twoJobBody)
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('returns 404 when VENDOR_MODE is live', async () => {
    mockMode.value = 'live'
    const res = await service.client.post(
      `${ROUTEPLANNER_PATH}?apiKey=${API_KEY}`,
      twoJobBody,
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('fails the armed campaign once, then succeeds', async () => {
    const campaign = await seedCampaign()
    await service.app.get(VendorMockRecordService).armRouteFail(campaign.id)
    const path = scopedPath(campaign.organizationSlug, 'routeplanner')

    const failRes = await service.client.post(
      `${path}?apiKey=${API_KEY}`,
      twoJobBody,
    )
    expect(failRes.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(failRes.data.message).toContain('mock route failure')

    const okRes = await service.client.post(
      `${path}?apiKey=${API_KEY}`,
      twoJobBody,
    )
    expect(okRes.status).toBe(HttpStatus.CREATED)
  })

  it("never fails a call that isn't the armed campaign's", async () => {
    const armed = await seedCampaign()
    const other = await seedCampaign()
    await service.app.get(VendorMockRecordService).armRouteFail(armed.id)

    const unscoped = await service.client.post(
      `${ROUTEPLANNER_PATH}?apiKey=${API_KEY}`,
      twoJobBody,
    )
    const otherRes = await service.client.post(
      `${scopedPath(other.organizationSlug, 'routeplanner')}?apiKey=${API_KEY}`,
      twoJobBody,
    )
    const armedRes = await service.client.post(
      `${scopedPath(armed.organizationSlug, 'routeplanner')}?apiKey=${API_KEY}`,
      twoJobBody,
    )

    expect(unscoped.status).toBe(HttpStatus.CREATED)
    expect(otherRes.status).toBe(HttpStatus.CREATED)
    expect(armedRes.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
  })

  it('records a scoped call against its campaign', async () => {
    const campaign = await seedCampaign()

    await service.client.post(
      `${scopedPath(campaign.organizationSlug, 'routeplanner')}?apiKey=${API_KEY}`,
      twoJobBody,
    )

    const records = await service.app
      .get(VendorMockRecordService)
      .findByCampaign(campaign.id)
    expect(records).toEqual([
      expect.objectContaining({ kind: 'routeplanner_request' }),
    ])
  })
})

describe('GET /v1/vendor-mocks/geoapify/v1/routing', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('returns a GeoJSON LineString with the correct coordinate count', async () => {
    const waypoints = '40.73,-73.935|40.732,-73.94|40.735,-73.945'
    const res = await service.client.get(
      `${ROUTING_PATH}?waypoints=${encodeURIComponent(waypoints)}&mode=walk&apiKey=${API_KEY}`,
    )

    expect(res.status).toBe(HttpStatus.OK)
    const feature = res.data.features[0]
    expect(feature.geometry.type).toBe('LineString')
    expect(feature.geometry.coordinates).toHaveLength(3)
  })

  it('stores a VendorMockRecord', async () => {
    const waypoints = '40.73,-73.935|40.732,-73.94'
    await service.client.get(
      `${ROUTING_PATH}?waypoints=${encodeURIComponent(waypoints)}&apiKey=${API_KEY}`,
    )

    const svc = service.app.get(VendorMockRecordService)
    const records = await svc.findMany({
      where: { vendor: VendorMockVendor.geoapify, kind: 'routing_request' },
    })
    expect(records.length).toBeGreaterThan(0)
  })

  it('returns 400 when apiKey is missing', async () => {
    const res = await service.client.get(
      `${ROUTING_PATH}?waypoints=40.73,-73.935|40.732,-73.94`,
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('returns 404 when VENDOR_MODE is live', async () => {
    mockMode.value = 'live'
    const res = await service.client.get(
      `${ROUTING_PATH}?waypoints=40.73,-73.935&apiKey=${API_KEY}`,
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns coords in [lng, lat] GeoJSON order for lat,lng input', async () => {
    const waypoints = '40.73,-73.935|40.732,-73.94'
    const res = await service.client.get(
      `${ROUTING_PATH}?waypoints=${encodeURIComponent(waypoints)}&mode=walk&apiKey=${API_KEY}`,
    )
    expect(res.status).toBe(HttpStatus.OK)
    const coords = res.data.features[0].geometry.coordinates
    expect(coords).toHaveLength(2)
    expect(coords[0]).toEqual([-73.935, 40.73])
    expect(coords[1]).toEqual([-73.94, 40.732])
  })

  it('returns coords in [lng, lat] GeoJSON order for lonlat: input', async () => {
    const waypoints = 'lonlat:-73.935,40.73|lonlat:-73.94,40.732'
    const res = await service.client.get(
      `${ROUTING_PATH}?waypoints=${encodeURIComponent(waypoints)}&mode=walk&apiKey=${API_KEY}`,
    )
    expect(res.status).toBe(HttpStatus.OK)
    const coords = res.data.features[0].geometry.coordinates
    expect(coords).toHaveLength(2)
    expect(coords[0]).toEqual([-73.935, 40.73])
    expect(coords[1]).toEqual([-73.94, 40.732])
  })
})

describe('GET /v1/vendor-mocks/geoapify/v1/geocode/reverse', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  const REVERSE_PATH = '/v1/vendor-mocks/geoapify/v1/geocode/reverse'

  it('answers a neighborhood or a road only, by the point', async () => {
    const neighborhood = await service.client.get(
      `${REVERSE_PATH}?lat=35.58&lon=-82.55&format=json&apiKey=${API_KEY}`,
    )
    const roadOnly = await service.client.get(
      `${REVERSE_PATH}?lat=35.59&lon=-82.55&format=json&apiKey=${API_KEY}`,
    )

    expect(neighborhood.status).toBe(HttpStatus.OK)
    expect(neighborhood.data.results[0].suburb).toEqual(expect.any(String))
    expect(roadOnly.data.results[0]).not.toHaveProperty('suburb')
    expect(roadOnly.data.results[0].street).toBe('Main Street')
  })

  it('returns 400 without a point and 404 in live mode', async () => {
    const noPoint = await service.client.get(
      `${REVERSE_PATH}?apiKey=${API_KEY}`,
    )
    expect(noPoint.status).toBe(HttpStatus.BAD_REQUEST)

    mockMode.value = 'live'
    const live = await service.client.get(
      `${REVERSE_PATH}?lat=35.58&lon=-82.55&apiKey=${API_KEY}`,
    )
    expect(live.status).toBe(HttpStatus.NOT_FOUND)
  })
})
