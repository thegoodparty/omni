import { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'
import { AxiosError } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { VoterDensityProxyService } from '../services/voter-density-proxy.service'

// e2e for GET /v1/public-person-profiles/voter-density. Boots the real app
// (testcontainers Postgres) and mocks ONLY the outbound election-api /
// people-api HTTP calls (via the proxy's HttpService), exercising the full
// controller + proxy path: district resolution, S2S call, response whitelist,
// and 404 for unresolved districts.
const service = useTestService()

const PERSON_ID = '33333333-3333-4333-8333-333333333333'
const DISTRICT_ID = '44444444-4444-4444-8444-444444444444'

// Swap the proxy's private HttpService.get with a URL-routed stub.
const mockHttp = (handlers: {
  voterDistrict?: () => unknown
  voterDensity?: (config?: { params?: { districtId?: string } }) => unknown
}) => {
  const proxy = service.app.get(VoterDensityProxyService)
  // Reach the private injected client to intercept both upstream calls.
  const http = (proxy as unknown as { httpService: HttpService }).httpService
  return vi
    .spyOn(http, 'get')
    .mockImplementation((url: string, config?: { params?: unknown }) => {
      if (url.includes('/voter-district')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return handlers.voterDistrict!() as any
      }
      if (url.includes('/voter-density')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return handlers.voterDensity!(config as any) as any
      }
      throw new Error(`Unexpected URL in test: ${url}`)
    })
}

const get = (personId: string = PERSON_ID) =>
  service.client.get('/v1/public-person-profiles/voter-density', {
    params: { personId },
  })

describe('GET /v1/public-person-profiles/voter-density', () => {
  it('returns coverage + cells for a resolvable district (live)', async () => {
    const spy = mockHttp({
      voterDistrict: () =>
        of({
          data: { personId: PERSON_ID, districtId: DISTRICT_ID, state: 'WY' },
        }),
      voterDensity: (config) => {
        // The proxy must scope the people-api call to the resolved district.
        expect(config?.params?.districtId).toBe(DISTRICT_ID)
        return of({
          data: {
            districtId: DISTRICT_ID,
            resolution: 8,
            coverage: 0.82,
            minCellCount: 10,
            cells: [{ lat: 41.1, lng: -104.8, count: 25 }],
          },
        })
      },
    })

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.coverage).toBe(0.82)
    expect(res.data.cells).toHaveLength(1)
    expect(res.data.cells[0]).toEqual({ lat: 41.1, lng: -104.8, count: 25 })
    // Whitelist: people-api-only fields must not leak through the boundary.
    expect(res.data.districtId).toBeUndefined()
    expect(res.data.minCellCount).toBeUndefined()
    expect(res.data.resolution).toBeUndefined()
    spy.mockRestore()
  })

  it('returns empty cells when the district has no coverage', async () => {
    const spy = mockHttp({
      voterDistrict: () =>
        of({
          data: { personId: PERSON_ID, districtId: DISTRICT_ID, state: 'WY' },
        }),
      voterDensity: () =>
        of({
          data: {
            districtId: DISTRICT_ID,
            resolution: 8,
            coverage: null,
            minCellCount: null,
            cells: [],
          },
        }),
    })

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.coverage).toBeNull()
    expect(res.data.cells).toEqual([])
    spy.mockRestore()
  })

  it('404s when the person maps to no district (null districtId)', async () => {
    const spy = mockHttp({
      voterDistrict: () =>
        of({ data: { personId: PERSON_ID, districtId: null, state: null } }),
    })

    const res = await get()
    expect(res.status).toBe(404)
    spy.mockRestore()
  })

  it('404s when election-api does not know the person', async () => {
    const spy = mockHttp({
      voterDistrict: () =>
        throwError(
          () =>
            new AxiosError('not found', 'ERR', undefined, undefined, {
              status: 404,
            } as never),
        ),
    })

    const res = await get()
    expect(res.status).toBe(404)
    spy.mockRestore()
  })

  it('400s on a non-uuid personId', async () => {
    const res = await get('not-a-uuid')
    expect(res.status).toBe(400)
  })
})
