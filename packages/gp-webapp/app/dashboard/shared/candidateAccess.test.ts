import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Organization } from 'gpApi/api-endpoints'
import candidateAccess, {
  getPostAuthRedirectPath,
  fetchCampaignStatus,
} from './candidateAccess'

const {
  mockAuth,
  mockHeadersGet,
  mockRedirect,
  mockGetCurrentUserOrganizations,
  mockServerFetch,
  mockGetServerUser,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHeadersGet: vi.fn(),
  mockRedirect: vi.fn(),
  mockGetCurrentUserOrganizations: vi.fn(),
  mockServerFetch: vi.fn(),
  mockGetServerUser: vi.fn(),
}))

vi.mock('gpApi/serverFetch', () => ({
  serverFetch: (...args: unknown[]) => mockServerFetch(...args),
}))

vi.mock('helpers/userServerHelper', () => ({
  getServerUser: () => mockGetServerUser(),
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) => mockHeadersGet(name),
    }),
}))

// Keep the real `unstable_rethrow` (and other exports) so post-swap
// candidateAccess.ts calls the genuine Next implementation against a real
// NEXT_REDIRECT-shaped error; only `redirect` itself is mocked so tests can
// control whether/how it throws without invoking full Next request context.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>()
  return {
    ...actual,
    redirect: (url: string) => mockRedirect(url),
  }
})

vi.mock('helpers/getCurrentUserOrganizations', () => ({
  getCurrentUserOrganizations: () => mockGetCurrentUserOrganizations(),
}))

const minimalOrg: Organization = {
  slug: 'campaign-1',
  name: '2026 Campaign',
  positionName: null,
  position: null,
  district: null,
  electedOfficeId: null,
  campaignId: 1,
  status: 'active',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRedirect.mockImplementation(() => undefined as never)
  mockGetCurrentUserOrganizations.mockResolvedValue([minimalOrg])
  mockGetServerUser.mockResolvedValue(null)
  mockServerFetch.mockResolvedValue({ ok: true, status: 200, data: {} })
})

// Dispatch serverFetch responses by the route's path so getPostAuthRedirectPath
// sees a campaign-less user whose elected-office state we control per test.
const routeServerFetch = (
  responses: Record<string, { ok: boolean; status: number; data: unknown }>,
) => {
  mockServerFetch.mockImplementation(
    async (route: { path?: string } | undefined) => {
      const path = route?.path ?? ''
      if (path.includes('/elected-office/mine')) {
        return responses.mine ?? { ok: true, status: 200, data: [] }
      }
      if (path.includes('/elected-office/current')) {
        return responses.current ?? { ok: false, status: 404, data: null }
      }
      // campaign status — default to "no campaign"
      return (
        responses.status ?? { ok: true, status: 200, data: { status: false } }
      )
    },
  )
}

describe('fetchCampaignStatus', () => {
  it('rethrows the redirect error on a 498 (expired legacy token) response', async () => {
    // Real Next `redirect()` always throws a NEXT_REDIRECT-digest error; simulate
    // that here since `redirect` is mocked as a no-op by default for the other
    // describe blocks. This is the regression this plan exists to protect: the
    // guard in the catch block must recognize and rethrow this error rather than
    // swallow it into `{ status: false }`.
    mockRedirect.mockImplementation(() => {
      throw Object.assign(new Error('NEXT_REDIRECT'), {
        digest: 'NEXT_REDIRECT;replace;/logout;307;',
      })
    })
    mockServerFetch.mockResolvedValue({ ok: false, status: 498, data: null })

    await expect(fetchCampaignStatus()).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT/),
    })
    expect(mockRedirect).toHaveBeenCalledWith('/logout')
  })

  it('resolves { status: false } when serverFetch rejects with a plain error', async () => {
    mockServerFetch.mockRejectedValue(new Error('network blew up'))

    await expect(fetchCampaignStatus()).resolves.toEqual({ status: false })
  })

  it('resolves the response body on a 200', async () => {
    const body = { status: true, slug: 'campaign-1' }
    mockServerFetch.mockResolvedValue({ ok: true, status: 200, data: body })

    await expect(fetchCampaignStatus()).resolves.toEqual(body)
  })
})

describe('getPostAuthRedirectPath', () => {
  it('routes an EO with incomplete serve onboarding to /serve/onboarding', async () => {
    routeServerFetch({
      current: { ok: false, status: 404, data: null },
      mine: {
        ok: true,
        status: 200,
        data: [{ onboardingCompletedAt: null }],
      },
    })

    await expect(getPostAuthRedirectPath()).resolves.toBe('/serve/onboarding')
  })

  it('routes an EO with completed serve onboarding to /dashboard', async () => {
    routeServerFetch({
      current: { ok: true, status: 200, data: { id: 'eo-1' } },
      mine: {
        ok: true,
        status: 200,
        data: [{ onboardingCompletedAt: '2026-01-01T00:00:00.000Z' }],
      },
    })

    await expect(getPostAuthRedirectPath()).resolves.toBe('/dashboard')
  })

  it('routes a user with no elected office to office selection', async () => {
    routeServerFetch({
      current: { ok: false, status: 404, data: null },
      mine: { ok: true, status: 200, data: [] },
    })

    await expect(getPostAuthRedirectPath()).resolves.toBe(
      '/onboarding/office-selection',
    )
  })

  it('treats an EO-owning org as holding an office when both EO endpoints miss', async () => {
    // A provisioning race can leave /current 404 and /mine empty while the org
    // already carries an electedOfficeId — the user must not be misclassified as
    // a brand-new candidate and sent to office selection.
    mockGetCurrentUserOrganizations.mockResolvedValue([
      { ...minimalOrg, electedOfficeId: 'eo-xyz' },
    ])
    routeServerFetch({
      current: { ok: false, status: 404, data: null },
      mine: { ok: true, status: 200, data: [] },
    })

    await expect(getPostAuthRedirectPath()).resolves.toBe('/dashboard')
  })
})

describe('candidateAccess', () => {
  it('redirects to sign-up when there is no Clerk userId', async () => {
    mockAuth.mockResolvedValue({ userId: null, actor: null })

    await candidateAccess()

    expect(mockRedirect).toHaveBeenCalledWith('/sign-up')
    expect(mockGetCurrentUserOrganizations).not.toHaveBeenCalled()
  })

  it('redirects orgless users away from /dashboard to office selection', async () => {
    mockAuth.mockResolvedValue({
      userId: 'user_2abc',
      actor: { sub: 'admin' },
    })
    mockHeadersGet.mockImplementation((name) =>
      name === 'x-pathname' ? '/dashboard' : null,
    )
    mockGetCurrentUserOrganizations.mockResolvedValue([])

    await candidateAccess()

    expect(mockGetCurrentUserOrganizations).toHaveBeenCalledOnce()
    expect(mockRedirect).toHaveBeenCalledWith('/onboarding/office-selection')
  })

  it('does not fetch organizations or redirect for orgless non-dashboard routes', async () => {
    mockAuth.mockResolvedValue({
      userId: 'user_2abc',
      actor: { sub: 'admin' },
    })
    mockHeadersGet.mockImplementation((name) =>
      name === 'x-pathname' ? '/polls/welcome' : null,
    )

    await candidateAccess()

    expect(mockGetCurrentUserOrganizations).not.toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('does not redirect to office selection when user has organizations on dashboard', async () => {
    mockAuth.mockResolvedValue({
      userId: 'user_2abc',
      actor: { sub: 'admin' },
    })
    mockHeadersGet.mockImplementation((name) =>
      name === 'x-pathname' ? '/dashboard/campaign-details' : null,
    )
    mockGetCurrentUserOrganizations.mockResolvedValue([minimalOrg])

    await candidateAccess()

    expect(mockGetCurrentUserOrganizations).toHaveBeenCalledOnce()
    expect(mockRedirect).not.toHaveBeenCalledWith(
      '/onboarding/office-selection',
    )
  })
})
