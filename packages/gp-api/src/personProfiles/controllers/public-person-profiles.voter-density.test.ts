import { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'
import { AxiosError } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { VoterDensityProxyService } from '../services/voter-density-proxy.service'

// e2e for GET /v1/public-person-profiles/voter-density. Boots the real app
// (testcontainers Postgres) and mocks ONLY the outbound election-api call,
// which answers both halves of the question — the person's district and that
// district's precomputed cells — in one request.
const service = useTestService()

const PERSON_ID = '33333333-3333-4333-8333-333333333333'
const DISTRICT_ID = '44444444-4444-4444-8444-444444444444'

// Swap the proxy's private HttpService.get with a stub for /voter-density.
const mockHttp = (handler: () => unknown) => {
  const proxy = service.app.get(VoterDensityProxyService)
  const http = (proxy as unknown as { httpService: HttpService }).httpService
  return vi.spyOn(http, 'get').mockImplementation((url: string) => {
    if (url.includes('/voter-density')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return handler() as any
    }
    throw new Error(`Unexpected upstream URL in test: ${url}`)
  })
}

/** election-api's one-call answer, as the proxy expects to receive it. */
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

const get = (personId: string = PERSON_ID) =>
  service.client.get('/v1/public-person-profiles/voter-density', {
    params: { personId },
  })

describe('GET /v1/public-person-profiles/voter-density', () => {
  it('returns coverage + cells for a district with density data', async () => {
    const httpSpy = mockHttp(() =>
      densityResponse({
        coverage: 0.82,
        cells: [
          { lat: 43.1, lng: -108.2, count: 25 },
          { lat: 43.2, lng: -108.3, count: 11 },
        ],
      }),
    )

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.coverage).toBe(0.82)
    expect(res.data.cells).toHaveLength(2)
    expect(res.data.cells[0]).toEqual({ lat: 43.1, lng: -108.2, count: 25 })
    httpSpy.mockRestore()
  })

  it('renders no map (empty cells) when the district has no density rows', async () => {
    const httpSpy = mockHttp(() =>
      densityResponse({ coverage: null, cells: [] }),
    )

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.coverage).toBeNull()
    expect(res.data.cells).toEqual([])
    httpSpy.mockRestore()
  })

  it('forwards the M2M Authorization header to election-api', async () => {
    // Guards the auth wiring: election-api is M2M-locked, so a missing bearer
    // 401s (→ 502). The test harness stubs ElectionApiTokenService.authHeader
    // to 'Bearer test-election-api-token'.
    let capturedHeaders: Record<string, string> | undefined
    const proxy = service.app.get(VoterDensityProxyService)
    const http = (proxy as unknown as { httpService: HttpService }).httpService
    const spy = vi
      .spyOn(http, 'get')
      .mockImplementation((url: string, config?: unknown) => {
        if (url.includes('/voter-density')) {
          capturedHeaders = (
            config as { headers?: Record<string, string> } | undefined
          )?.headers
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return densityResponse({ coverage: 0.5, cells: [] }) as any
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
    const spy = mockHttp(() => densityResponse({ districtId: null }))

    const res = await get()
    expect(res.status).toBe(404)
    spy.mockRestore()
  })

  it('404s when election-api does not know the person', async () => {
    const spy = mockHttp(() =>
      throwError(
        () =>
          new AxiosError('not found', 'ERR', undefined, undefined, {
            status: 404,
          } as never),
      ),
    )

    const res = await get()
    expect(res.status).toBe(404)
    spy.mockRestore()
  })

  it('502s (not swallowed) when election-api hard-fails with a non-404', async () => {
    const spy = mockHttp(() =>
      throwError(
        () =>
          new AxiosError('boom', 'ERR', undefined, undefined, {
            status: 500,
          } as never),
      ),
    )

    const res = await get()
    expect(res.status).toBe(502)
    spy.mockRestore()
  })

  it('400s on a non-uuid personId', async () => {
    const res = await get('not-a-uuid')
    expect(res.status).toBe(400)
  })
})
