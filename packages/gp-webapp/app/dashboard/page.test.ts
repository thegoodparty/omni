import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiRoutes } from 'gpApi/routes'
import type { ApiRoute } from 'gpApi/routes'

const LATENCY_MS = 50

const {
  mockCandidateAccess,
  mockServerFetch,
  mockFetchUserWebsite,
  mockRedirect,
} = vi.hoisted(() => ({
  mockCandidateAccess: vi.fn(),
  mockServerFetch: vi.fn(),
  mockFetchUserWebsite: vi.fn(),
  mockRedirect: vi.fn(),
}))

vi.mock('./shared/candidateAccess', () => ({
  default: () => mockCandidateAccess(),
}))
vi.mock('gpApi/serverFetch', () => ({
  serverFetch: (endpoint: ApiRoute) => mockServerFetch(endpoint),
}))
vi.mock('helpers/fetchUserWebsite', () => ({
  fetchUserWebsite: () => mockFetchUserWebsite(),
}))
vi.mock('./shared/websiteSunset', () => ({
  isWebsiteSunsetEligible: () => false,
}))
vi.mock('./components/DashboardContent', () => ({
  default: () => null,
}))
vi.mock('helpers/metadataHelper', () => ({
  default: () => ({}),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}))

import Page from './page'

class RedirectError extends Error {
  constructor(public url: string) {
    super(`redirect:${url}`)
    this.name = 'RedirectError'
  }
}

const ELECTED_OFFICE_PATH = apiRoutes.electedOffice.current.path
const TCR_PATH = apiRoutes.campaign.tcrCompliance.fetch.path

const delay = <T>(value: T, ms = LATENCY_MS): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

// Routes serverFetch results by endpoint path so the page's two distinct
// serverFetch calls (elected-office gate, then tcr compliance) resolve
// independently. `hasElectedOffice` toggles the chief-of-staff redirect gate.
const wireServerFetch = ({
  hasElectedOffice,
  latency = 0,
}: {
  hasElectedOffice: boolean
  latency?: number
}) =>
  mockServerFetch.mockImplementation((endpoint: ApiRoute) => {
    if (endpoint.path === ELECTED_OFFICE_PATH) {
      return delay(
        hasElectedOffice
          ? { ok: true, data: { id: 'eo-1' } }
          : { ok: false, data: null },
        latency,
      )
    }
    if (endpoint.path === TCR_PATH) {
      return delay({ ok: true, data: { registered: true } }, latency)
    }
    return delay({ ok: false, data: null }, latency)
  })

// Mirrors the ORIGINAL serial ordering to benchmark against the same latencies.
async function serialBaseline(): Promise<void> {
  await mockCandidateAccess()
  const eo = (await mockServerFetch(apiRoutes.electedOffice.current)) as {
    ok?: boolean
    data?: unknown
  }
  if (eo?.ok && eo?.data) {
    mockRedirect('/dashboard/chief-of-staff')
    return
  }
  await Promise.all([
    mockServerFetch(apiRoutes.campaign.tcrCompliance.fetch),
    mockFetchUserWebsite(),
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCandidateAccess.mockResolvedValue(undefined)
  mockFetchUserWebsite.mockResolvedValue(null)
  mockRedirect.mockImplementation((url: string) => {
    throw new RedirectError(url)
  })
})

describe('dashboard Page behavior', () => {
  it('redirects to chief-of-staff when a current elected office exists, skipping tcr/website', async () => {
    wireServerFetch({ hasElectedOffice: true })

    await expect(Page()).rejects.toMatchObject({
      name: 'RedirectError',
      url: '/dashboard/chief-of-staff',
    })

    const fetchedPaths = mockServerFetch.mock.calls.map(
      ([endpoint]) => (endpoint as ApiRoute).path,
    )
    expect(fetchedPaths).toContain(ELECTED_OFFICE_PATH)
    expect(fetchedPaths).not.toContain(TCR_PATH)
    expect(mockFetchUserWebsite).not.toHaveBeenCalled()
  })

  it('renders the dashboard (fetching tcr + website) when there is no current elected office', async () => {
    wireServerFetch({ hasElectedOffice: false })

    await expect(Page()).resolves.toBeDefined()

    const fetchedPaths = mockServerFetch.mock.calls.map(
      ([endpoint]) => (endpoint as ApiRoute).path,
    )
    expect(fetchedPaths).toContain(ELECTED_OFFICE_PATH)
    expect(fetchedPaths).toContain(TCR_PATH)
    expect(mockFetchUserWebsite).toHaveBeenCalledTimes(1)
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('honors the candidateAccess gate redirect and skips tcr/website', async () => {
    mockCandidateAccess.mockImplementation(() => {
      throw new RedirectError('/sign-up')
    })
    wireServerFetch({ hasElectedOffice: false })

    await expect(Page()).rejects.toMatchObject({
      name: 'RedirectError',
      url: '/sign-up',
    })

    const fetchedPaths = mockServerFetch.mock.calls.map(
      ([endpoint]) => (endpoint as ApiRoute).path,
    )
    expect(fetchedPaths).not.toContain(TCR_PATH)
    expect(mockFetchUserWebsite).not.toHaveBeenCalled()
  })

  it('surfaces the candidateAccess redirect even if the overlapped elected-office fetch rejects', async () => {
    // The gate must win: an elected-office fetch failure must not preempt or
    // mask the redirect that candidateAccess would have thrown serially.
    mockCandidateAccess.mockImplementation(async () => {
      await delay(undefined, 10)
      throw new RedirectError('/onboarding/office-selection')
    })
    mockServerFetch.mockImplementation((endpoint: ApiRoute) => {
      if (endpoint.path === ELECTED_OFFICE_PATH) {
        return Promise.reject(new Error('elected-office 500'))
      }
      return delay({ ok: true, data: {} })
    })

    await expect(Page()).rejects.toMatchObject({
      name: 'RedirectError',
      url: '/onboarding/office-selection',
    })
  })

  it('starts the elected-office fetch concurrently with candidateAccess', async () => {
    let electedOfficeStartedWhileAccessPending = false
    let accessResolved = false
    mockCandidateAccess.mockImplementation(() =>
      delay(undefined).then(() => {
        accessResolved = true
      }),
    )
    mockServerFetch.mockImplementation((endpoint: ApiRoute) => {
      if (endpoint.path === ELECTED_OFFICE_PATH) {
        electedOfficeStartedWhileAccessPending = !accessResolved
        return delay({ ok: false, data: null })
      }
      return delay({ ok: false, data: null })
    })

    await Page()
    expect(electedOfficeStartedWhileAccessPending).toBe(true)
  })
})

describe('dashboard Page benchmark', () => {
  it('parallelized page is measurably faster than the serial baseline', async () => {
    // candidateAccess carries latency here to represent its internal
    // auth → orgs → campaign-status round trips that the elected-office fetch
    // now overlaps with.
    mockCandidateAccess.mockImplementation(() => delay(undefined))
    wireServerFetch({ hasElectedOffice: false, latency: LATENCY_MS })

    const beforeStart = performance.now()
    await serialBaseline()
    const beforeMs = performance.now() - beforeStart

    const afterStart = performance.now()
    await Page()
    const afterMs = performance.now() - afterStart

    // eslint-disable-next-line no-console
    console.log(
      `[bench dashboard] before=${beforeMs.toFixed(1)}ms after=${afterMs.toFixed(1)}ms (latency ${LATENCY_MS}ms/call)`,
    )

    // BEFORE ~= candidateAccess + electedOffice serial then tcr||website (~3L);
    // AFTER ~= max(candidateAccess, electedOffice) then tcr||website (~2L).
    expect(beforeMs).toBeGreaterThan(LATENCY_MS * 2.5)
    expect(afterMs).toBeLessThan(beforeMs)
    expect(beforeMs - afterMs).toBeGreaterThan(LATENCY_MS * 0.5)
  })
})
