import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import PostAuthRedirectPage from './page'

vi.mock('@clerk/nextjs', () => ({
  useUser: vi.fn(() => ({
    isSignedIn: true,
    isLoaded: true,
    user: {
      primaryEmailAddress: { emailAddress: 'clerk-fallback@example.com' },
    },
  })),
}))

const mockSetCookie = vi.fn<(name: string, value: string) => void>()
const mockGetCookie = vi.fn<(name: string) => string | false>(() => false)
vi.mock('helpers/cookieHelper', () => ({
  getCookie: (name: string) => mockGetCookie(name),
  setCookie: (name: string, value: string) => mockSetCookie(name, value),
  deleteCookie: vi.fn(),
}))

const mockTrackRegistration =
  vi.fn<(args: { userId: string; email?: string }) => void>()
vi.mock('helpers/analyticsHelper', () => ({
  trackRegistrationCompleted: (args: { userId: string; email?: string }) =>
    mockTrackRegistration(args),
}))
vi.mock('@shared/utils/analytics', () => ({
  getReadyAnalytics: vi.fn().mockResolvedValue(null),
}))

let replaceSpy: ReturnType<typeof vi.fn>

const setLocation = (search = '') => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, replace: replaceSpy, search },
  })
}

beforeEach(() => {
  mockSetCookie.mockClear()
  mockGetCookie.mockClear()
  mockGetCookie.mockImplementation(() => false)
  mockTrackRegistration.mockClear()
  replaceSpy = vi.fn()
  setLocation('')
})

afterEach(() => {
  vi.useRealTimers()
})

const orgFixture = {
  slug: 'org-one',
  name: 'Org One',
  positionName: null,
  position: null,
  district: null,
  electedOfficeId: null,
  campaignId: 1,
  status: 'active' as const,
}

describe('PostAuthRedirectPage', () => {
  it('happy path: orgs returned, resolves to /dashboard for active candidate', async () => {
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [orgFixture] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: 'candidate', slug: 'org-one' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
    expect(mockSetCookie).toHaveBeenCalledWith('organization-slug', 'org-one')
  })

  it('retry path: first orgs call fails, second succeeds; uses retry orgs', async () => {
    api.mockOrdered('GET /v1/organizations', [
      { status: 500, data: { message: 'transient' } },
      { status: 200, data: { organizations: [orgFixture] } },
    ])
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: 'candidate', slug: 'org-one' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'), {
      timeout: 3000,
    })
    expect(mockSetCookie).toHaveBeenCalledWith('organization-slug', 'org-one')
  })

  it('double-failure path: both orgs calls fail; falls through to /onboarding/office-selection', async () => {
    api.mock('GET /v1/organizations', {
      status: 500,
      data: { message: 'down' },
    })
    api.mock('GET /v1/users/me', { status: 500, data: { message: 'down' } })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 500,
      data: { message: 'down' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 500,
      data: { message: 'down' },
    })
    api.mock('GET /v1/elected-office/mine', {
      status: 500,
      data: { message: 'down' },
    })

    render(<PostAuthRedirectPage />)

    await waitFor(
      () =>
        expect(replaceSpy).toHaveBeenCalledWith('/onboarding/office-selection'),
      { timeout: 3000 },
    )
    expect(mockSetCookie).not.toHaveBeenCalled()
  })

  it('redirects to /login when not signed in', async () => {
    const clerkMod = await import('@clerk/nextjs')
    vi.mocked(clerkMod.useUser).mockReturnValueOnce({
      isSignedIn: false,
      isLoaded: true,
    } as any)

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/login'))
  })

  it('signup source + fresh createdAt: fires trackRegistrationCompleted and submits the CRM registration with the hubspotutk', async () => {
    setLocation('?source=signup')
    mockGetCookie.mockImplementation((name) =>
      name === 'hubspotutk' ? 'test-hutk-cookie' : false,
    )
    const crmRegistrationBodies: Array<{ hutk?: string }> = []
    api.mock('POST /v1/users/me/crm-registration', ({ body }) => {
      crmRegistrationBodies.push(body)
      return { status: 200, data: {} }
    })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [orgFixture] },
    })
    api.mock('GET /v1/users/me', {
      status: 200,
      data: {
        id: 42,
        email: 'new-user@example.com',
        roles: [],
        createdAt: new Date().toISOString(),
      } as any,
    })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: 'candidate', slug: 'org-one' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
    expect(crmRegistrationBodies).toEqual([{ hutk: 'test-hutk-cookie' }])
    expect(mockTrackRegistration).toHaveBeenCalledTimes(1)
    expect(mockTrackRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '42',
        email: 'new-user@example.com',
      }),
    )
  })

  it('signup source + fresh createdAt, no hubspotutk cookie: still submits the CRM registration without a hutk', async () => {
    setLocation('?source=signup')
    const crmRegistrationBodies: Array<{ hutk?: string }> = []
    api.mock('POST /v1/users/me/crm-registration', ({ body }) => {
      crmRegistrationBodies.push(body)
      return { status: 200, data: {} }
    })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [orgFixture] },
    })
    api.mock('GET /v1/users/me', {
      status: 200,
      data: {
        id: 42,
        email: 'new-user@example.com',
        roles: [],
        createdAt: new Date().toISOString(),
      } as any,
    })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: 'candidate', slug: 'org-one' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
    expect(crmRegistrationBodies).toEqual([{}])
  })

  it('signup source + stale createdAt: does NOT fire (URL-tampering guard)', async () => {
    setLocation('?source=signup')
    const crmRegistrationBodies: Array<{ hutk?: string }> = []
    api.mock('POST /v1/users/me/crm-registration', ({ body }) => {
      crmRegistrationBodies.push(body)
      return { status: 200, data: {} }
    })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [orgFixture] },
    })
    api.mock('GET /v1/users/me', {
      status: 200,
      data: {
        id: 42,
        email: 'old-user@example.com',
        roles: [],
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      } as any,
    })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: 'candidate', slug: 'org-one' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
    expect(mockTrackRegistration).not.toHaveBeenCalled()
    expect(crmRegistrationBodies).toEqual([])
  })

  it('next param: honors a same-origin deep link over the resolved path', async () => {
    setLocation('?next=%2Fdashboard%2Fbriefings')
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [orgFixture] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: 'candidate', slug: 'org-one' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith('/dashboard/briefings'),
    )
    // Org context is still established before navigating to the deep link.
    expect(mockSetCookie).toHaveBeenCalledWith('organization-slug', 'org-one')
  })

  it('next param: selects the elected-office org for a briefings deep link', async () => {
    setLocation('?next=%2Fdashboard%2Fbriefings')
    const electedOfficeOrg = {
      ...orgFixture,
      slug: 'serve-org',
      name: 'Serve Org',
      electedOfficeId: 'eo-123',
    }
    api.mock('GET /v1/organizations', {
      status: 200,
      // Campaign org first (resolveSlug would otherwise pick this one).
      data: { organizations: [orgFixture, electedOfficeOrg] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: 'candidate', slug: 'org-one' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 200,
      data: { id: 'eo-123', swornInDate: '2026-01-01' } as any,
    })
    api.mock('GET /v1/elected-office/mine', {
      status: 200,
      data: [{ id: 'eo-123', onboardingCompletedAt: '2026-02-01' }] as any,
    })

    render(<PostAuthRedirectPage />)

    await waitFor(() =>
      expect(mockSetCookie).toHaveBeenCalledWith(
        'organization-slug',
        'serve-org',
      ),
    )
    expect(replaceSpy).toHaveBeenCalledWith('/dashboard/briefings')
  })

  it('next param: ignores protocol-relative/open-redirect values', async () => {
    setLocation('?next=%2F%2Fevil.com')
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [orgFixture] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: 'candidate', slug: 'org-one' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
  })

  it('routes an incomplete serve-lead EO (no campaign) to serve onboarding even when a campaign org is listed first', async () => {
    const electedOfficeOrg = {
      ...orgFixture,
      slug: 'serve-org',
      name: 'Serve Org',
      electedOfficeId: 'eo-9',
    }
    api.mock('GET /v1/organizations', {
      status: 200,
      // Campaign org first; resolveSlug picks it so /current 404s for the EO.
      data: { organizations: [orgFixture, electedOfficeOrg] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    // No active campaign — the EO branch should take over.
    api.mock('GET /v1/campaigns/mine/status', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    // A genuine serve lead: incomplete onboarding AND no campaign of origin.
    api.mock('GET /v1/elected-office/mine', {
      status: 200,
      data: [
        { id: 'eo-9', onboardingCompletedAt: null, campaignId: null },
      ] as any,
    })

    render(<PostAuthRedirectPage />)

    await waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith('/serve/onboarding'),
    )
  })

  it('routes a just-won, win-origin EO (has campaign, no term dates) to the dashboard, not serve onboarding', async () => {
    // The just-won routing bug: an office created by winning a campaign carries a
    // campaignId and has already onboarded as a candidate, so a missing
    // onboardingCompletedAt/term date must NOT drag it into serve onboarding.
    const electedOfficeOrg = {
      ...orgFixture,
      slug: 'serve-org',
      name: 'Serve Org',
      electedOfficeId: 'eo-win',
    }
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [orgFixture, electedOfficeOrg] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', {
      status: 200,
      data: [
        {
          id: 'eo-win',
          onboardingCompletedAt: null,
          campaignId: 7,
          termStartDate: null,
          termEndDate: null,
        },
      ] as any,
    })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
  })

  it('routes to /dashboard (not serve onboarding) when an EO org exists but no EO record resolves', async () => {
    // Legacy win→serve user: an elected-office org is present, but /current
    // 404s (campaign org sorts first) and /mine returns empty. With no
    // resolvable EO record we must default to "complete" and land on
    // /dashboard rather than looping back into /serve/onboarding every login.
    const electedOfficeOrg = {
      ...orgFixture,
      slug: 'serve-org',
      name: 'Serve Org',
      electedOfficeId: 'eo-legacy',
    }
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [orgFixture, electedOfficeOrg] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
  })

  it('login (no source param): does not fire trackRegistrationCompleted', async () => {
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [orgFixture] },
    })
    api.mock('GET /v1/users/me', {
      status: 200,
      data: {
        id: 42,
        email: 'returning@example.com',
        roles: [],
        createdAt: new Date().toISOString(),
      } as any,
    })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: 'candidate', slug: 'org-one' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
    expect(mockTrackRegistration).not.toHaveBeenCalled()
  })
})
