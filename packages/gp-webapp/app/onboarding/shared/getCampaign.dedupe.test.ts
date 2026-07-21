import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// React ships two builds of `cache()`: the client/isomorphic build that Vitest
// resolves for `import 'react'` is a no-op passthrough, while the `react-server`
// build (what Next.js compiles server components against) implements real
// request-scoped memoization. To benchmark the behaviour our fix actually gets
// in production we load the server build directly and mock it into the module
// under test.
const req = createRequire(import.meta.url)
const serverReact = req(
  join(dirname(req.resolve('react/package.json')), 'react.react-server.js'),
) as {
  cache: <T extends (...args: never[]) => unknown>(fn: T) => T
  __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
    A: unknown
  }
}

const serverCache = serverReact.cache
const internals =
  serverReact.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

// Installs the same shape of per-request cache dispatcher that React's server
// runtime sets up for the lifetime of a single render, runs `run()` inside it,
// then restores the previous dispatcher. Without an active scope `cache()`
// falls back to calling the wrapped function directly (the pre-fix behaviour).
async function withRenderScope<T>(run: () => Promise<T>): Promise<T> {
  const store = new Map<unknown, unknown>()
  const dispatcher = {
    getCacheForType<R>(resourceType: () => R): R {
      if (!store.has(resourceType)) store.set(resourceType, resourceType())
      return store.get(resourceType) as R
    },
    cacheSignal: () => null,
  }
  const prev = internals.A
  internals.A = dispatcher
  try {
    return await run()
  } finally {
    internals.A = prev
  }
}

const { mockServerRequest, mockGetServerToken } = vi.hoisted(() => ({
  mockServerRequest: vi.fn(),
  mockGetServerToken: vi.fn(),
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, cache: serverCache }
})

vi.mock('gpApi/server-request', () => ({
  serverRequest: (...args: unknown[]) => mockServerRequest(...args),
}))

vi.mock('helpers/tokenHelper', () => ({
  getServerToken: () => mockGetServerToken(),
  isTokenExpired: () => false,
}))

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('helpers/linkhelper', () => ({ getMarketingUrl: (p: string) => p }))

const campaign = { id: 7, slug: 'jane-for-mayor' }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerToken.mockResolvedValue('valid.jwt.token')
  mockServerRequest.mockResolvedValue({ ok: true, data: campaign })
})

describe('fetchUserCampaign request-scoped dedupe benchmark', () => {
  it('BEFORE (no cache scope, == plain async fn): PageWrapper + page = 2 GET /v1/campaigns/mine', async () => {
    const { fetchUserCampaign } = await import('./getCampaign')

    // Two independent call sites in one page load (the PageWrapper layout and
    // the dashboard page it renders) with no request-scoped cache active.
    const [fromLayout, fromPage] = await Promise.all([
      fetchUserCampaign(),
      fetchUserCampaign(),
    ])

    expect(mockServerRequest).toHaveBeenCalledTimes(2)
    expect(mockServerRequest).toHaveBeenCalledWith(
      'GET /v1/campaigns/mine',
      {},
      { ignoreResponseError: true },
    )
    expect(fromLayout).toEqual(campaign)
    expect(fromPage).toEqual(campaign)
  })

  it('AFTER (single render scope, the fix): PageWrapper + page = 1 GET /v1/campaigns/mine', async () => {
    const { fetchUserCampaign } = await import('./getCampaign')

    const [fromLayout, fromPage] = await withRenderScope(() =>
      Promise.all([fetchUserCampaign(), fetchUserCampaign()]),
    )

    // React `cache()` collapses the duplicate call within one server render.
    expect(mockServerRequest).toHaveBeenCalledTimes(1)
    // Behaviour is unchanged: every caller still receives the same campaign.
    expect(fromLayout).toEqual(campaign)
    expect(fromPage).toEqual(campaign)
    expect(fromLayout).toBe(fromPage)
  })

  it('does not leak the cache across renders (each render fetches once)', async () => {
    const { fetchUserCampaign } = await import('./getCampaign')

    await withRenderScope(() =>
      Promise.all([fetchUserCampaign(), fetchUserCampaign()]),
    )
    await withRenderScope(() =>
      Promise.all([fetchUserCampaign(), fetchUserCampaign()]),
    )

    expect(mockServerRequest).toHaveBeenCalledTimes(2)
  })

  it('still short-circuits to null without a valid token (no fetch)', async () => {
    const { fetchUserCampaign } = await import('./getCampaign')
    mockGetServerToken.mockResolvedValue(undefined)

    const result = await withRenderScope(() => fetchUserCampaign())

    expect(result).toBeNull()
    expect(mockServerRequest).not.toHaveBeenCalled()
  })
})
