import { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'
import { AxiosError } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { VoterDensityService } from '@/peopleDb/services/voterDensity.service'
import { VoterDensityProxyService } from '../services/voter-density-proxy.service'

// e2e for GET /v1/public-person-profiles/voter-density. Boots the real app
// (testcontainers Postgres) and mocks ONLY the two dependencies the proxy
// fans out to: the outbound election-api call (via HttpService) for district
// resolution, and the people-db density read (VoterDensityService) — people-db
// has no test container, so it is mocked here like everywhere else in peopleDb.
// This exercises the controller + proxy path: district resolution, the
// people-db read, and 404 for unresolved districts.
const service = useTestService()

const PERSON_ID = '33333333-3333-4333-8333-333333333333'
const DISTRICT_ID = '44444444-4444-4444-8444-444444444444'

// Swap the proxy's private HttpService.get with a URL-routed stub. Only
// /voter-district is expected — the density cells no longer come over HTTP.
const mockHttp = (handlers: { voterDistrict: () => unknown }) => {
  const proxy = service.app.get(VoterDensityProxyService)
  const http = (proxy as unknown as { httpService: HttpService }).httpService
  return vi.spyOn(http, 'get').mockImplementation((url: string) => {
    if (url.includes('/voter-district')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return handlers.voterDistrict() as any
    }
    throw new Error(`Unexpected upstream URL in test: ${url}`)
  })
}

const mockDensity = (result: {
  coverage: number | null
  cells: { lat: number; lng: number; count: number }[]
}) =>
  vi
    .spyOn(service.app.get(VoterDensityService), 'getVoterDensity')
    .mockResolvedValue(result)

const resolvableDistrict = () =>
  mockHttp({
    voterDistrict: () =>
      of({
        data: { personId: PERSON_ID, districtId: DISTRICT_ID, state: 'WY' },
      }),
  })

const get = (personId: string = PERSON_ID) =>
  service.client.get('/v1/public-person-profiles/voter-density', {
    params: { personId },
  })

describe('GET /v1/public-person-profiles/voter-density', () => {
  it('returns coverage + cells for a district with density data', async () => {
    const httpSpy = resolvableDistrict()
    const densitySpy = mockDensity({
      coverage: 0.82,
      cells: [
        { lat: 43.1, lng: -108.2, count: 25 },
        { lat: 43.2, lng: -108.3, count: 11 },
      ],
    })

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.coverage).toBe(0.82)
    expect(res.data.cells).toHaveLength(2)
    expect(res.data.cells[0]).toEqual({ lat: 43.1, lng: -108.2, count: 25 })
    expect(densitySpy).toHaveBeenCalledWith(DISTRICT_ID)
    httpSpy.mockRestore()
    densitySpy.mockRestore()
  })

  it('renders no map (empty cells) when the district has no density rows', async () => {
    const httpSpy = resolvableDistrict()
    const densitySpy = mockDensity({ coverage: null, cells: [] })

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.coverage).toBeNull()
    expect(res.data.cells).toEqual([])
    httpSpy.mockRestore()
    densitySpy.mockRestore()
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
