import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FetchError } from 'ofetch'

const { mockCandidateAccess, mockServerRequest } = vi.hoisted(() => ({
  mockCandidateAccess: vi.fn(),
  mockServerRequest: vi.fn(),
}))

vi.mock('app/dashboard/shared/candidateAccess', () => ({
  default: () => mockCandidateAccess(),
}))
vi.mock('gpApi/server-request', () => ({
  serverRequest: (route: string, payload: unknown) =>
    mockServerRequest(route, payload),
}))

import { GET } from './route'

const ROUTE = 'GET /v1/door-knocking/turfs/:id/route'
const TURFS = 'GET /v1/door-knocking/turfs'

const routePayload = {
  route: {
    id: 5,
    doorKnockingTurfId: 3,
    mode: 'walk',
    loop: true,
    totalSeconds: 1860,
    totalMeters: 3218,
    stopCount: 0,
    createdAt: new Date('2026-07-21T00:00:00Z'),
  },
  pathGeometry: null,
  stops: [],
}

const fetchError = (status: number): FetchError => {
  const error = new FetchError(`HTTP ${status}`)
  error.status = status
  return error
}

const get = (turfId: string) =>
  GET(new Request(`https://app.test/x/${turfId}/pdf`), {
    params: Promise.resolve({ turfId }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mockCandidateAccess.mockResolvedValue(undefined)
  mockServerRequest.mockImplementation((route: string) => {
    if (route === ROUTE) return Promise.resolve({ data: routePayload })
    if (route === TURFS) {
      return Promise.resolve({ data: [{ id: 7, name: 'Elm & Cedar' }] })
    }
    return Promise.reject(new Error(`unexpected route ${route}`))
  })
})

describe('walk list PDF route', () => {
  it('serves a PDF named after the list', async () => {
    const response = await get('7')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="elm-cedar.pdf"',
    )
    // A walk list is voter data and goes stale the moment a door is logged.
    expect(response.headers.get('Cache-Control')).toBe('no-store')

    const body = Buffer.from(await response.arrayBuffer())
    expect(body.subarray(0, 5).toString()).toBe('%PDF-')
  }, 30_000)

  // The route this builds is voter data, so the auth gate has to run before
  // anything is fetched, not alongside it.
  it('honors the candidateAccess gate without fetching', async () => {
    mockCandidateAccess.mockRejectedValue(new Error('redirect:/sign-up'))

    await expect(get('7')).rejects.toThrow('redirect:/sign-up')
    expect(mockServerRequest).not.toHaveBeenCalled()
  })

  it('404s a turf with no route, or one that is not yours', async () => {
    mockServerRequest.mockImplementation((route: string) =>
      route === ROUTE
        ? Promise.reject(fetchError(404))
        : Promise.resolve({ data: [] }),
    )

    expect((await get('7')).status).toBe(404)
  })

  // gp-api parses the id with ParseIntPipe, which 400s rather than 404s.
  it('404s a non-numeric id without calling the API', async () => {
    expect((await get('foo')).status).toBe(404)
    expect(mockServerRequest).not.toHaveBeenCalled()
  })

  // A 500 or a timeout is not "your route is gone" — swallowing it would tell
  // a canvasser chasing signal to give up on a route that exists.
  it('lets a server failure surface instead of claiming the route is missing', async () => {
    mockServerRequest.mockImplementation((route: string) =>
      route === ROUTE
        ? Promise.reject(fetchError(500))
        : Promise.resolve({ data: [] }),
    )

    await expect(get('7')).rejects.toBeInstanceOf(FetchError)
  })

  // The name is decoration; losing it must not cost the canvasser the list.
  it('falls back to a generic filename when the turf name cannot be read', async () => {
    mockServerRequest.mockImplementation((route: string) =>
      route === ROUTE
        ? Promise.resolve({ data: routePayload })
        : Promise.reject(fetchError(500)),
    )

    const response = await get('7')

    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="walk-list.pdf"',
    )
  }, 30_000)
})
