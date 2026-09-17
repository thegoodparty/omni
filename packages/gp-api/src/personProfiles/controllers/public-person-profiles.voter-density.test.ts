import { HttpService } from '@nestjs/axios'
import { NEVER, of, throwError } from 'rxjs'
import { AxiosError } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

// Swap the proxy's private HttpService.get with a URL-routed stub. Two routes
// are in play while the serving tables move: /voter-district (the legacy leg's
// district resolution, paired with a people-db read) and /voter-density (the
// new leg, which answers both halves at once). A handler left unset stands for
// an upstream that does not have the route, which is the shadow-leg failure the
// proxy must absorb rather than propagate.
const mockHttp = (handlers: {
  voterDistrict?: () => unknown
  voterDensity?: () => unknown
}) => {
  const proxy = service.app.get(VoterDensityProxyService)
  const http = (proxy as unknown as { httpService: HttpService }).httpService
  return vi.spyOn(http, 'get').mockImplementation((url: string) => {
    if (url.includes('/voter-density') && handlers.voterDensity) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return handlers.voterDensity() as any
    }
    if (url.includes('/voter-district') && handlers.voterDistrict) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return handlers.voterDistrict() as any
    }
    throw new Error(`Unexpected upstream URL in test: ${url}`)
  })
}

/** election-api's one-call answer, as the new leg expects to receive it. */
const densityResponse = (body: {
  districtId?: string | null
  coverage?: number | null
  cells?: { lat: number; lng: number; count: number }[]
}) =>
  of({
    data: {
      personId: PERSON_ID,
      districtId: body.districtId === undefined ? DISTRICT_ID : body.districtId,
      coverage: body.coverage ?? null,
      cells: body.cells ?? [],
    },
  })

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

  it('forwards the M2M Authorization header to election-api', async () => {
    // Guards the auth wiring: election-api is M2M-locked, so a missing bearer
    // 401s (→ 502). The test harness stubs ElectionApiTokenService.authHeader to
    // 'Bearer test-election-api-token'.
    let capturedHeaders: Record<string, string> | undefined
    // District resolution succeeds here, so the proxy goes on to read people-db;
    // stub that too or the unmocked client throws and the assertion sees a 500.
    const densitySpy = mockDensity({ coverage: 0.5, cells: [] })
    const proxy = service.app.get(VoterDensityProxyService)
    const http = (proxy as unknown as { httpService: HttpService }).httpService
    const spy = vi
      .spyOn(http, 'get')
      .mockImplementation((url: string, config?: unknown) => {
        if (url.includes('/voter-district')) {
          capturedHeaders = (
            config as { headers?: Record<string, string> } | undefined
          )?.headers
          const response = of({
            data: { personId: PERSON_ID, districtId: DISTRICT_ID, state: 'WY' },
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return response as any
        }
        throw new Error(`Unexpected upstream URL in test: ${url}`)
      })

    const res = await get()

    expect(res.status).toBe(200)
    expect(capturedHeaders?.Authorization).toBe(
      'Bearer test-election-api-token',
    )
    spy.mockRestore()
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

  it('502s (not swallowed) when election-api hard-fails with a non-404', async () => {
    const spy = mockHttp({
      voterDistrict: () =>
        throwError(
          () =>
            new AxiosError('boom', 'ERR', undefined, undefined, {
              status: 500,
            } as never),
        ),
    })

    const res = await get()
    expect(res.status).toBe(502)
    spy.mockRestore()
  })

  it('400s on a non-uuid personId', async () => {
    const res = await get('not-a-uuid')
    expect(res.status).toBe(400)
  })
})

// The migration window: both sources are read on every request and compared,
// and VOTER_DENSITY_SOURCE picks which one is believed. The rule that matters
// is that the shadow leg can fail in any way without the page noticing.
describe('voter-density dual reads', () => {
  const originalSource = process.env.VOTER_DENSITY_SOURCE

  const useSource = (source: 'people-db' | 'election-api') => {
    if (source === 'election-api') process.env.VOTER_DENSITY_SOURCE = source
    else delete process.env.VOTER_DENSITY_SOURCE
  }

  afterEach(() => {
    if (originalSource === undefined) delete process.env.VOTER_DENSITY_SOURCE
    else process.env.VOTER_DENSITY_SOURCE = originalSource
  })

  const LEGACY_CELLS = [{ lat: 43.1, lng: -108.2, count: 25 }]
  const NEW_CELLS = [{ lat: 44.9, lng: -109.9, count: 99 }]

  it('serves people-db by default, even when election-api disagrees', async () => {
    useSource('people-db')
    const httpSpy = mockHttp({
      voterDistrict: () =>
        of({ data: { personId: PERSON_ID, districtId: DISTRICT_ID } }),
      voterDensity: () => densityResponse({ coverage: 0.1, cells: NEW_CELLS }),
    })
    const densitySpy = mockDensity({ coverage: 0.82, cells: LEGACY_CELLS })

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.cells).toEqual(LEGACY_CELLS)
    expect(res.data.coverage).toBe(0.82)
    httpSpy.mockRestore()
    densitySpy.mockRestore()
  })

  it('serves election-api once the flag is flipped', async () => {
    useSource('election-api')
    const httpSpy = mockHttp({
      voterDistrict: () =>
        of({ data: { personId: PERSON_ID, districtId: DISTRICT_ID } }),
      voterDensity: () => densityResponse({ coverage: 0.42, cells: NEW_CELLS }),
    })
    const densitySpy = mockDensity({ coverage: 0.82, cells: LEGACY_CELLS })

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.cells).toEqual(NEW_CELLS)
    expect(res.data.coverage).toBe(0.42)
    httpSpy.mockRestore()
    densitySpy.mockRestore()
  })

  it('still serves people-db when the election-api shadow leg hard-fails', async () => {
    // The entire safety property of the dual-read window. A 500 on the route
    // being introduced must not take down a page that works today.
    useSource('people-db')
    const httpSpy = mockHttp({
      voterDistrict: () =>
        of({ data: { personId: PERSON_ID, districtId: DISTRICT_ID } }),
      voterDensity: () =>
        throwError(
          () =>
            new AxiosError('boom', 'ERR', undefined, undefined, {
              status: 500,
            } as never),
        ),
    })
    const densitySpy = mockDensity({ coverage: 0.82, cells: LEGACY_CELLS })

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.cells).toEqual(LEGACY_CELLS)
    httpSpy.mockRestore()
    densitySpy.mockRestore()
  })

  it('still serves people-db when election-api has no such route yet', async () => {
    // What a not-yet-deployed election-api actually looks like: a 404 on the
    // new path, which must not read as "this person has no map".
    useSource('people-db')
    const httpSpy = mockHttp({
      voterDistrict: () =>
        of({ data: { personId: PERSON_ID, districtId: DISTRICT_ID } }),
      voterDensity: () =>
        throwError(
          () =>
            new AxiosError('nope', 'ERR', undefined, undefined, {
              status: 404,
            } as never),
        ),
    })
    const densitySpy = mockDensity({ coverage: 0.82, cells: LEGACY_CELLS })

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.cells).toEqual(LEGACY_CELLS)
    httpSpy.mockRestore()
    densitySpy.mockRestore()
  })

  it('answers without waiting for the shadow leg to come back', async () => {
    // The shadow is for our benefit, not the caller's, so it must not sit on
    // the response's critical path. A shadow that never returns stands in for
    // one that is merely slow: if this ever awaits both legs again, the request
    // hangs here instead of quietly costing every map the slower of the two.
    useSource('people-db')
    const httpSpy = mockHttp({
      voterDistrict: () =>
        of({ data: { personId: PERSON_ID, districtId: DISTRICT_ID } }),
      voterDensity: () => NEVER,
    })
    const densitySpy = mockDensity({ coverage: 0.82, cells: LEGACY_CELLS })

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.cells).toEqual(LEGACY_CELLS)
    httpSpy.mockRestore()
    densitySpy.mockRestore()
  })

  it('still serves election-api when the people-db shadow leg hard-fails', async () => {
    // The mirror case, which is what protects the rollback: after the flip,
    // people-db becomes the shadow and its failures must be equally inert.
    useSource('election-api')
    const httpSpy = mockHttp({
      voterDistrict: () =>
        of({ data: { personId: PERSON_ID, districtId: DISTRICT_ID } }),
      voterDensity: () => densityResponse({ coverage: 0.42, cells: NEW_CELLS }),
    })
    const densitySpy = vi
      .spyOn(service.app.get(VoterDensityService), 'getVoterDensity')
      .mockRejectedValue(new Error('people-db is gone'))

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.cells).toEqual(NEW_CELLS)
    httpSpy.mockRestore()
    densitySpy.mockRestore()
  })

  it('404s when election-api resolves the person to no district, once flipped', async () => {
    useSource('election-api')
    const httpSpy = mockHttp({
      voterDistrict: () =>
        of({ data: { personId: PERSON_ID, districtId: null } }),
      voterDensity: () => densityResponse({ districtId: null }),
    })
    const densitySpy = mockDensity({ coverage: null, cells: [] })

    const res = await get()

    expect(res.status).toBe(404)
    httpSpy.mockRestore()
    densitySpy.mockRestore()
  })

  it('502s when the authoritative election-api leg hard-fails, once flipped', async () => {
    // Authoritative failures keep surfacing; only shadow failures are absorbed.
    useSource('election-api')
    const httpSpy = mockHttp({
      voterDistrict: () =>
        of({ data: { personId: PERSON_ID, districtId: DISTRICT_ID } }),
      voterDensity: () =>
        throwError(
          () =>
            new AxiosError('boom', 'ERR', undefined, undefined, {
              status: 500,
            } as never),
        ),
    })
    const densitySpy = mockDensity({ coverage: 0.82, cells: LEGACY_CELLS })

    const res = await get()

    expect(res.status).toBe(502)
    httpSpy.mockRestore()
    densitySpy.mockRestore()
  })

  it('reads both sources on a single request', async () => {
    useSource('people-db')
    const httpSpy = mockHttp({
      voterDistrict: () =>
        of({ data: { personId: PERSON_ID, districtId: DISTRICT_ID } }),
      voterDensity: () =>
        densityResponse({ coverage: 0.82, cells: LEGACY_CELLS }),
    })
    const densitySpy = mockDensity({ coverage: 0.82, cells: LEGACY_CELLS })

    await get()

    const urls = httpSpy.mock.calls.map(([url]) => url as string)
    expect(urls.some((u) => u.includes('/voter-district'))).toBe(true)
    expect(urls.some((u) => u.includes('/voter-density'))).toBe(true)
    expect(densitySpy).toHaveBeenCalledWith(DISTRICT_ID)
    httpSpy.mockRestore()
    densitySpy.mockRestore()
  })
})
