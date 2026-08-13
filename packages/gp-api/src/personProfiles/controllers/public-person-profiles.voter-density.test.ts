import { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'
import { AxiosError } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { VoterDensityProxyService } from '../services/voter-density-proxy.service'

// e2e for GET /v1/public-person-profiles/voter-density. Boots the real app
// (testcontainers Postgres) and mocks ONLY the outbound election-api call (via
// the proxy's HttpService), exercising the controller + proxy path: district
// resolution, and 404 for unresolved districts. The density cells themselves
// have no backend (the people-api endpoint was removed and never implemented),
// so a resolvable district renders no map until a people-db query exists.
const service = useTestService()

const PERSON_ID = '33333333-3333-4333-8333-333333333333'
const DISTRICT_ID = '44444444-4444-4444-8444-444444444444'

// Swap the proxy's private HttpService.get with a URL-routed stub. Only
// /voter-district is expected now — any /voter-density call is a regression
// (the people-api proxy was removed) and fails the test loudly.
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

const get = (personId: string = PERSON_ID) =>
  service.client.get('/v1/public-person-profiles/voter-density', {
    params: { personId },
  })

describe('GET /v1/public-person-profiles/voter-density', () => {
  it('renders no map (null coverage, empty cells) for a resolvable district', async () => {
    const spy = mockHttp({
      voterDistrict: () =>
        of({
          data: { personId: PERSON_ID, districtId: DISTRICT_ID, state: 'WY' },
        }),
    })

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.coverage).toBeNull()
    expect(res.data.cells).toEqual([])
    spy.mockRestore()
  })

  it('forwards the M2M Authorization header to election-api', async () => {
    // Guards the auth wiring: election-api is M2M-locked, so a missing bearer
    // would 401 (→ 502) once ELECTION_API_AUTH_ENFORCED is on. The test harness
    // stubs ElectionApiTokenService.authHeader to 'Bearer test-election-api-token'.
    let capturedHeaders: Record<string, string> | undefined
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
