import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FetchError } from 'ofetch'

const { mockCandidateAccess, mockServerRequest, mockNotFound } = vi.hoisted(
  () => ({
    mockCandidateAccess: vi.fn(),
    mockServerRequest: vi.fn(),
    mockNotFound: vi.fn(),
  }),
)

vi.mock('app/dashboard/shared/candidateAccess', () => ({
  default: () => mockCandidateAccess(),
}))
vi.mock('gpApi/server-request', () => ({
  serverRequest: (route: string, payload: unknown) =>
    mockServerRequest(route, payload),
}))
vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}))
vi.mock('helpers/metadataHelper', () => ({ default: () => ({}) }))

import Page from './page'

const ROUTE = 'GET /v1/door-knocking/turfs/:id/route'
const TURFS = 'GET /v1/door-knocking/turfs'

const routePayload = { route: { id: 5 }, pathGeometry: null, stops: [] }

const fetchError = (status: number): FetchError => {
  const error = new FetchError(`HTTP ${status}`)
  error.status = status
  return error
}

// notFound() throws in Next so nothing after it runs; the mock has to as well,
// or a test would assert against a page that kept going.
class NotFoundError extends Error {}

// The page returns a WalkSheet element rather than rendering one, so the
// assertions read the props it handed over.
const sheetProps = async (
  turfId: string,
): Promise<{ turfName: string; payload: unknown }> => {
  const element = await Page({ params: Promise.resolve({ turfId }) })
  return element.props as { turfName: string; payload: unknown }
}

const render = (turfId: string) => Page({ params: Promise.resolve({ turfId }) })

const requestedRoutes = (): string[] =>
  mockServerRequest.mock.calls.map(([route]) => route as string)

beforeEach(() => {
  vi.clearAllMocks()
  mockCandidateAccess.mockResolvedValue(undefined)
  mockNotFound.mockImplementation(() => {
    throw new NotFoundError('not found')
  })
  mockServerRequest.mockImplementation((route: string) => {
    if (route === ROUTE) return Promise.resolve({ data: routePayload })
    if (route === TURFS) {
      return Promise.resolve({ data: [{ id: 7, name: 'Elm & Cedar' }] })
    }
    return Promise.reject(new Error(`unexpected route ${route}`))
  })
})

describe('walk list print Page', () => {
  it('renders the sheet with the turf name', async () => {
    expect(await sheetProps('7')).toEqual({
      turfName: 'Elm & Cedar',
      payload: routePayload,
    })
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  // The route this sheet prints is voter data, so the auth gate has to run
  // before anything is fetched, not alongside it.
  it('honors the candidateAccess gate without fetching', async () => {
    mockCandidateAccess.mockRejectedValue(new Error('redirect:/sign-up'))

    await expect(render('7')).rejects.toThrow('redirect:/sign-up')
    expect(mockServerRequest).not.toHaveBeenCalled()
  })

  it('404s a turf with no route, or one that is not yours', async () => {
    mockServerRequest.mockImplementation((route: string) =>
      route === ROUTE
        ? Promise.reject(fetchError(404))
        : Promise.resolve({ data: [] }),
    )

    await expect(render('7')).rejects.toThrow(NotFoundError)
  })

  // A 500 or a timeout is not "your route is gone" — swallowing it would tell
  // a canvasser chasing signal to give up on a route that exists.
  it('lets a server failure surface instead of claiming the route is missing', async () => {
    mockServerRequest.mockImplementation((route: string) =>
      route === ROUTE
        ? Promise.reject(fetchError(500))
        : Promise.resolve({ data: [] }),
    )

    await expect(render('7')).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof FetchError && !(error instanceof NotFoundError),
    )
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  // gp-api parses the id with ParseIntPipe, which 400s rather than 404s.
  it('404s a non-numeric id without calling the API', async () => {
    await expect(render('foo')).rejects.toThrow(NotFoundError)
    expect(mockServerRequest).not.toHaveBeenCalled()
  })

  // The name is decoration; losing it must not cost the canvasser the list.
  it('still prints the list when the turf name cannot be read', async () => {
    mockServerRequest.mockImplementation((route: string) =>
      route === ROUTE
        ? Promise.resolve({ data: routePayload })
        : Promise.reject(fetchError(500)),
    )

    expect(await sheetProps('7')).toEqual({
      turfName: 'Walk list',
      payload: routePayload,
    })
  })

  it('falls back to a generic name when the turf is missing from the list', async () => {
    mockServerRequest.mockImplementation((route: string) =>
      route === ROUTE
        ? Promise.resolve({ data: routePayload })
        : Promise.resolve({ data: [{ id: 99, name: 'Someone else' }] }),
    )

    expect((await sheetProps('7')).turfName).toBe('Walk list')
  })

  it('asks for the turf the URL names', async () => {
    await render('7')

    expect(requestedRoutes()).toContain(ROUTE)
    expect(mockServerRequest).toHaveBeenCalledWith(ROUTE, { id: '7' })
  })
})
