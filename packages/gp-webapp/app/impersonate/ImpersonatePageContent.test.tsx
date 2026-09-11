import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import ImpersonatePageContent from './ImpersonatePageContent'

const mockClearElectionResultDismissed = vi.fn()
vi.mock('app/dashboard/election-result/dismissal', () => ({
  clearElectionResultDismissed: () => mockClearElectionResultDismissed(),
}))

const mockSignOut = vi.fn()
const mockSetActive = vi.fn()
const mockSignInCreate = vi.fn()
vi.mock('@clerk/nextjs', () => ({
  useClerk: () => ({
    client: { signIn: { create: mockSignInCreate } },
    setActive: mockSetActive,
    signOut: mockSignOut,
    loaded: true,
  }),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ __clerk_ticket: 'ticket-abc' }),
}))

const mockClientRequest = vi.fn()
vi.mock('gpApi/typed-request', () => ({
  clientRequest: (...args: unknown[]) => mockClientRequest(...args),
}))

const mockSetCookie = vi.fn()
vi.mock('helpers/cookieHelper', () => ({
  setCookie: (name: string, value: string) => mockSetCookie(name, value),
}))

const org = (slug: string, electedOfficeId: string | null) => ({
  slug,
  name: slug,
  positionName: null,
  position: null,
  district: null,
  electedOfficeId,
  campaignId: electedOfficeId ? null : 1,
  status: 'active' as const,
})

describe('ImpersonatePageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignOut.mockResolvedValue(undefined)
    mockSetActive.mockResolvedValue(undefined)
    mockSignInCreate.mockResolvedValue({
      status: 'complete',
      createdSessionId: 'sess-1',
    })
    // The component navigates via window.location.href; stub it so jsdom does
    // not attempt a real navigation.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    })
    mockClientRequest.mockResolvedValue({
      ok: true,
      data: {
        // Server order: gp-api decides which org leads, and the first entry is
        // the default for a user who has not picked one.
        organizations: [org('eo-9', '9'), org('campaign-1', null)],
      },
    })
  })

  it('clears the election-result dismissal after activating the impersonated session', async () => {
    render(<ImpersonatePageContent />)

    await waitFor(() =>
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess-1' }),
    )
    // Starting a new impersonation session in the same tab must clear any
    // prior candidate's election-result dismissal.
    expect(mockClearElectionResultDismissed).toHaveBeenCalled()
  })

  // The org-slug cookie is host-scoped and lives for 120 days, so without this
  // the staff member's browser hands the impersonated session the previous
  // user's org. Every server component reads that cookie for the
  // X-Organization-Slug header, so the first dashboard render answers for an
  // org this user cannot see while the client tree resolves a different one.
  it("selects this user's organization before handing off to the dashboard", async () => {
    render(<ImpersonatePageContent />)

    await waitFor(() =>
      expect(mockSetCookie).toHaveBeenCalledWith('organization-slug', 'eo-9'),
    )
    expect(window.location.href).toBe('/dashboard')
  })

  it('ignores any org slug already in the browser', async () => {
    // Whatever the admin (or the last impersonation) left behind is not this
    // user's, so it is never a candidate — the list alone decides. Asserted by
    // reading the resolver's input: no cookie is ever read on this path.
    render(<ImpersonatePageContent />)

    await waitFor(() => expect(mockClientRequest).toHaveBeenCalled())
    expect(mockClientRequest).toHaveBeenCalledWith(
      'GET /v1/organizations',
      {},
      { ignoreResponseError: true },
    )
    await waitFor(() =>
      expect(mockSetCookie).toHaveBeenCalledWith('organization-slug', 'eo-9'),
    )
  })

  it('still completes the hand-off when the org list cannot be read', async () => {
    // Clerk's session cookie can still be propagating on the first
    // authenticated call. A failure here must never strand the admin on the
    // interstitial; the provider repairs the cookie on the client instead.
    mockClientRequest.mockRejectedValue(new Error('network'))

    render(<ImpersonatePageContent />)

    await waitFor(() => expect(window.location.href).toBe('/dashboard'))
    expect(mockSetCookie).not.toHaveBeenCalled()
  })

  it('leaves the cookie alone when the org list comes back not-ok', async () => {
    mockClientRequest.mockResolvedValue({ ok: false, data: undefined })

    render(<ImpersonatePageContent />)

    await waitFor(() => expect(window.location.href).toBe('/dashboard'))
    expect(mockSetCookie).not.toHaveBeenCalled()
  })
})
