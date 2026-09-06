import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import * as resolverModule from 'helpers/resolvePostAuthRedirectPath.util'
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

// Real `useTeamAccountsFlag` reads through `FeatureFlagsProvider`'s context,
// which this file's `render()` doesn't wrap — so without this mock every
// test would silently read the context's off-by-default value. Controlling
// it directly lets the volunteer-routing tests below assert both the
// flag-on and flag-off (byte-identical-to-today) branches.
const mockUseTeamAccountsFlag = vi.fn(() => ({
  ready: true,
  enabled: false,
  failed: false,
}))
vi.mock('@shared/experiments/teamAccountsFlag', () => ({
  useTeamAccountsFlag: (...args: unknown[]) =>
    mockUseTeamAccountsFlag(...(args as [])),
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
  mockUseTeamAccountsFlag.mockReset().mockReturnValue({
    ready: true,
    enabled: false,
    failed: false,
  })
  replaceSpy = vi.fn()
  setLocation('')
  // Zero-org sessions probe gp-api for a pending invite on the invitee's
  // verified email (ENG-11027) — default it to none; the fallback-routing
  // tests below override it.
  api.mock('GET /v1/organizations/team/invites/mine', {
    status: 200,
    data: { invite: null },
  })
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

  it('exhausted-retries path: orgs call fails on every attempt; falls through to /onboarding/office-selection', async () => {
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
      { timeout: 4000 },
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

  it('routes to /team-invite ahead of an otherwise-active candidate status when Clerk publicMetadata carries a valid pending invite', async () => {
    const clerkMod = await import('@clerk/nextjs')
    vi.mocked(clerkMod.useUser).mockReturnValueOnce({
      isSignedIn: true,
      isLoaded: true,
      user: {
        primaryEmailAddress: { emailAddress: 'invitee@example.com' },
        publicMetadata: {
          organizationSlug: 'org-one',
          role: 'campaignAdmin',
          name: 'Invitee Name',
          invitedByUserId: 7,
        },
      },
    } as any)
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

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/team-invite'))
  })

  it('routes to /team-invite even when a ?next= param is present (pending invite takes priority)', async () => {
    setLocation('?next=%2Fdashboard%2Fbriefings')
    const clerkMod = await import('@clerk/nextjs')
    vi.mocked(clerkMod.useUser).mockReturnValueOnce({
      isSignedIn: true,
      isLoaded: true,
      user: {
        primaryEmailAddress: { emailAddress: 'invitee@example.com' },
        publicMetadata: {
          organizationSlug: 'org-one',
          role: 'campaignAdmin',
          name: 'Invitee Name',
          invitedByUserId: 7,
        },
      },
    } as any)
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

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/team-invite'))
  })

  it('ignores malformed Clerk publicMetadata and falls through to the normal candidate routing', async () => {
    const clerkMod = await import('@clerk/nextjs')
    vi.mocked(clerkMod.useUser).mockReturnValueOnce({
      isSignedIn: true,
      isLoaded: true,
      user: {
        primaryEmailAddress: { emailAddress: 'user@example.com' },
        // Missing required fields (role, name, invitedByUserId) — must never
        // be treated as a pending invite.
        publicMetadata: { organizationSlug: 'org-one' },
      },
    } as any)
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

  it('routes to /team-invite when a zero-org session has a pending invitation on its email (ENG-11027 fallback)', async () => {
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [] },
    })
    api.mock('GET /v1/organizations/team/invites/mine', {
      status: 200,
      data: {
        invite: { organizationSlug: 'org-one', role: 'campaignAdmin' },
      },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: false },
    })
    api.mock('GET /v1/elected-office/current', { status: 404, data: {} })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/team-invite'))
  })

  it('does not probe for a pending invitation when the session already has an org', async () => {
    let mineProbed = false
    api.mock('GET /v1/organizations/team/invites/mine', () => {
      mineProbed = true
      return { status: 200, data: { invite: null } }
    })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [orgFixture] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: 'candidate' },
    })
    api.mock('GET /v1/elected-office/current', { status: 404, data: {} })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
    expect(mineProbed).toBe(false)
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

  // ENG-11052: this is the client-side OTP counterpart to
  // candidateAccess.ts's server-side isActiveOrgVolunteer — a volunteer who
  // authenticates via /post-auth-redirect (rather than through a
  // server-rendered page) must land on /volunteer, not be misrouted into
  // onboarding because campaignStatus reads false for them.
  it('routes an active-org volunteer to /volunteer when win-team-accounts is on', async () => {
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: true,
      failed: false,
    })
    const volunteerOrg = { ...orgFixture, role: 'volunteer' as const }
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [volunteerOrg] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: false },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/volunteer'))
  })

  // ENG-11073: this used to assert byte-identical-to-today behavior (routes
  // to onboarding) for a volunteer-role org when the flag reads off. That was
  // wrong: a flag-off user with a volunteer-role org can only exist where
  // team-accounts membership creation put them there, so candidate
  // onboarding was never the right destination for them — it's exactly the
  // "successful-but-wrong evaluation" live repro (flag settles false, not
  // failed, on a cold pass before identity attaches). The org role alone now
  // routes them to /dashboard instead, same as the flag-failed case below.
  it('routes a volunteer-role org to /dashboard even when the flag reads off (not failed) — the live cold-login repro', async () => {
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: false,
      failed: false,
    })
    const volunteerOrg = { ...orgFixture, role: 'volunteer' as const }
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [volunteerOrg] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: false },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
    expect(replaceSpy).not.toHaveBeenCalledWith('/onboarding/office-selection')
  })

  // ENG-11052 (delegate round 3): teamAccountsEnabled is a value the effect
  // closes over once and never re-reads. If the flag isn't ready yet (e.g.
  // the SSR seed came back null and FeatureFlagsProvider's async refresh()
  // hasn't settled), the effect must not run and permanently latch a stale
  // `false` — it has to wait for `ready` and re-fire once the real value
  // lands. This reproduces that race: render while unready, confirm nothing
  // fires, then flip the flag on-and-ready and confirm the redirect only
  // fires now, to /volunteer.
  it('does not resolve the redirect before the flag is ready, and re-runs once it is', async () => {
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: false,
      enabled: false,
      failed: false,
    })
    const volunteerOrg = { ...orgFixture, role: 'volunteer' as const }
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [volunteerOrg] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: false },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    const { rerender } = render(<PostAuthRedirectPage />)

    // Nothing can have fired yet: the effect returns before touching any of
    // the org/campaign/elected-office calls the redirect depends on.
    expect(replaceSpy).not.toHaveBeenCalled()

    // FeatureFlagsProvider's refresh() settles (mirrors it winning the race
    // against Clerk hydration, whichever order they resolve in).
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: true,
      failed: false,
    })
    rerender(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/volunteer'))
  })

  // ENG-11071 repro (failure mode a): a cold login can race Clerk's
  // cookie/JWT propagation, failing the orgs fetch's single retry and
  // misrouting an established volunteer into candidate onboarding. Two
  // failures followed by a third, successful attempt exercises exactly the
  // gap the old single-retry code couldn't cover.
  it('cold-login race: orgs fetch fails twice, succeeds on a 3rd attempt; volunteer still routes to /volunteer', async () => {
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: true,
      failed: false,
    })
    const volunteerOrg = { ...orgFixture, role: 'volunteer' as const }
    api.mockOrdered('GET /v1/organizations', [
      { status: 401, data: { message: 'auth not propagated yet' } },
      { status: 401, data: { message: 'auth not propagated yet' } },
      { status: 200, data: { organizations: [volunteerOrg] } },
    ])
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 403,
      data: { message: 'forbidden for volunteers' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/volunteer'), {
      timeout: 4000,
    })
    expect(replaceSpy).not.toHaveBeenCalledWith('/onboarding/office-selection')
  })

  // ENG-11071/11073: a FAILED flag fetch reads exactly like "off" to the
  // resolver, so a confirmed volunteer-role org must not fall through to
  // onboarding just because `enabled` is false. This is now just one instance
  // of the general rule (ENG-11073): the org role alone decides the
  // /dashboard override, regardless of why the flag read false.
  it('flag fetch genuinely failed (not evaluated off): volunteer-role org falls back to /dashboard, not onboarding', async () => {
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: false,
      failed: true,
    })
    const volunteerOrg = { ...orgFixture, role: 'volunteer' as const }
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [volunteerOrg] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 403,
      data: { message: 'forbidden for volunteers' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
    expect(replaceSpy).not.toHaveBeenCalledWith('/onboarding/office-selection')
  })

  // ENG-11071: the outer catch's "onboarding is the safe default" fallback is
  // wrong for a confirmed volunteer — it would create them a campaign. Force
  // the resolver to throw after `activeOrgIsVolunteer` has already been
  // established (organizations resolved successfully) and confirm the catch
  // lands on /dashboard instead.
  it('outer catch: resolver throws after a volunteer-role org is confirmed; falls back to /dashboard, not onboarding', async () => {
    const resolverSpy = vi
      .spyOn(resolverModule, 'resolvePostAuthRedirectPath')
      .mockImplementationOnce(() => {
        throw new Error('boom')
      })
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: true,
      failed: false,
    })
    const volunteerOrg = { ...orgFixture, role: 'volunteer' as const }
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [volunteerOrg] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 403,
      data: { message: 'forbidden for volunteers' },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
    expect(replaceSpy).not.toHaveBeenCalledWith('/onboarding/office-selection')
    resolverSpy.mockRestore()
  })

  // ENG-11072: gp-api's UseCampaignGuard fails closed on a volunteer
  // membership, so this call always 403s for one — skip it outright rather
  // than firing a request whose response is thrown away either way. Gated on
  // the org role alone (not the flag): the null this produces behaves
  // identically to the `{ status: false }` a real 403/200-false response
  // would produce, in every branch of resolvePostAuthRedirectPath.
  it('does not request /v1/campaigns/mine/status for a volunteer-role active org, even with the flag on', async () => {
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: true,
      failed: false,
    })
    let statusProbed = false
    api.mock('GET /v1/campaigns/mine/status', () => {
      statusProbed = true
      return { status: 200, data: { status: false } }
    })
    const volunteerOrg = { ...orgFixture, role: 'volunteer' as const }
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [volunteerOrg] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/volunteer'))
    expect(statusProbed).toBe(false)
  })

  // ENG-11073: the guard skip is still gated on the org role alone, flag
  // state aside — that part is unchanged. But the destination it lands on
  // now also follows the org role alone (see the test above), so a
  // volunteer-role org resolves to /dashboard here too, not onboarding.
  it('does not request /v1/campaigns/mine/status for a volunteer-role active org when the flag is off (role alone gates it)', async () => {
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: false,
      failed: false,
    })
    let statusProbed = false
    api.mock('GET /v1/campaigns/mine/status', () => {
      statusProbed = true
      return { status: 200, data: { status: false } }
    })
    const volunteerOrg = { ...orgFixture, role: 'volunteer' as const }
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [volunteerOrg] },
    })
    api.mock('GET /v1/users/me', { status: 200, data: { roles: [] } as any })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'none' },
    })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] as any })

    render(<PostAuthRedirectPage />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
    expect(statusProbed).toBe(false)
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
