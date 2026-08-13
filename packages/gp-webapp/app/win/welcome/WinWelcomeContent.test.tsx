import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import WinWelcomeContent from './WinWelcomeContent'
import { WIN_ONBOARDING_PATH } from 'helpers/resolvePostAuthRedirectPath.util'

const mockSignOut = vi.fn()
const mockSetActive = vi.fn()
const mockSignInCreate = vi.fn()

// `user` mirrors Clerk's active-session signal: truthy (with an `id`) when a
// session is already active in the browser, null on a fresh visit.
let mockUser: { id: string } | null = null

vi.mock('@clerk/nextjs', () => ({
  useClerk: () => ({
    client: { signIn: { create: mockSignInCreate } },
    setActive: mockSetActive,
    signOut: mockSignOut,
    loaded: true,
    user: mockUser,
  }),
}))

let mockSearchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

// The redeemed ping is a fire-and-forget call to gp-api; stub it so it never
// hits the network, and assert it fires after a successful redemption.
const mockClientRequest = vi.fn()
vi.mock('gpApi/typed-request', () => ({
  clientRequest: (...args: unknown[]) => mockClientRequest(...args),
}))

// Stub Segment fan-out; keep the real EVENTS map so the asserted event name
// stays in lockstep with the registry.
vi.mock('helpers/analyticsHelper', async (importActual) => {
  const actual = await importActual<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

const trackEventMock = vi.mocked(trackEvent)

const POST_AUTH = `/post-auth-redirect?next=${encodeURIComponent(
  WIN_ONBOARDING_PATH,
)}`

// Build a minimal JWT (header.payload.signature) whose payload carries the
// given claims, matching the shape `decodeTicketUserId` parses.
function makeTicket(claims: Record<string, unknown>): string {
  const b64 = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.signature`
}

const ticketFor = (sub: string) =>
  new URLSearchParams({ __clerk_ticket: makeTicket({ sub }) })

const continueButton = () =>
  screen.getByRole('button', { name: /continue to goodparty/i })

describe('WinWelcomeContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = null
    mockSearchParams = ticketFor('user_ticket')
    mockSignOut.mockResolvedValue(undefined)
    mockSetActive.mockResolvedValue(undefined)
    mockSignInCreate.mockResolvedValue({
      status: 'complete',
      createdSessionId: 'sess-1',
    })
    mockClientRequest.mockResolvedValue(undefined)
    // The component navigates via window.location.href; stub it so jsdom does
    // not attempt a real navigation.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    })
  })

  it('renders the landing page and does NOT redeem on load (prefetch / Safe-Links safe)', async () => {
    render(<WinWelcomeContent />)

    // The CTA is shown, but nothing is redeemed until the human clicks — this
    // is what protects the one-time ticket from email scanners and unfurlers.
    await waitFor(() => expect(continueButton()).toBeEnabled())
    expect(mockSignInCreate).not.toHaveBeenCalled()
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockSetActive).not.toHaveBeenCalled()
  })

  it('redeems on click with no active session and routes to post-auth', async () => {
    render(<WinWelcomeContent />)

    fireEvent.click(continueButton())

    await waitFor(() =>
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess-1' }),
    )
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockSignInCreate).toHaveBeenCalledWith({
      strategy: 'ticket',
      ticket: mockSearchParams.get('__clerk_ticket'),
    })
    expect(window.location.href).toBe(POST_AUTH)
  })

  it('pings gp-api to mark the link redeemed after activating the session', async () => {
    render(<WinWelcomeContent />)

    fireEvent.click(continueButton())

    await waitFor(() =>
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess-1' }),
    )
    expect(mockClientRequest).toHaveBeenCalledWith(
      'POST /v1/campaigns/magic-link/redeemed',
      {},
      { keepalive: true },
    )
    // The redeemed ping is best-effort and must not block the redirect.
    expect(window.location.href).toBe(POST_AUTH)
  })

  it('still redirects when the redeemed ping rejects (best-effort)', async () => {
    mockClientRequest.mockRejectedValue(new Error('network'))

    render(<WinWelcomeContent />)
    fireEvent.click(continueButton())

    await waitFor(() => expect(window.location.href).toBe(POST_AUTH))
  })

  it('does NOT ping gp-api when redemption is skipped (already the ticket user)', async () => {
    mockUser = { id: 'user_same' }
    mockSearchParams = ticketFor('user_same')

    render(<WinWelcomeContent />)
    fireEvent.click(continueButton())

    await waitFor(() => expect(window.location.href).toBe(POST_AUTH))
    expect(mockClientRequest).not.toHaveBeenCalled()
  })

  it('signs out a different active session (without navigating) before redeeming on click', async () => {
    mockUser = { id: 'user_existing' }
    mockSearchParams = ticketFor('user_other')
    // Assert ordering from within the mock: sign-out must run before redemption.
    mockSignOut.mockImplementation(async () => {
      expect(mockSignInCreate).not.toHaveBeenCalled()
    })

    render(<WinWelcomeContent />)
    fireEvent.click(continueButton())

    await waitFor(() =>
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess-1' }),
    )
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    // The no-op callback form is used so Clerk runs the callback instead of its
    // default post-sign-out redirect.
    expect(mockSignOut).toHaveBeenCalledWith(expect.any(Function))
    expect(window.location.href).toBe(POST_AUTH)
  })

  it('redeems only once on a rapid double-click (does not double-spend the ticket)', async () => {
    render(<WinWelcomeContent />)

    const button = continueButton()
    // Two clicks fire before React re-renders the button as disabled.
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() =>
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess-1' }),
    )
    expect(mockSignInCreate).toHaveBeenCalledTimes(1)
  })

  it('skips redemption when already signed in as the ticket user', async () => {
    mockUser = { id: 'user_same' }
    mockSearchParams = ticketFor('user_same')

    render(<WinWelcomeContent />)
    fireEvent.click(continueButton())

    await waitFor(() => expect(window.location.href).toBe(POST_AUTH))
    // Same user: we must NOT burn the one-time ticket, and must not error.
    expect(mockSignInCreate).not.toHaveBeenCalled()
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(screen.queryByText(/couldn’t sign you in/i)).not.toBeInTheDocument()
  })

  it('shows an error with a /login link when redemption fails on click', async () => {
    mockSignInCreate.mockResolvedValue({
      status: 'needs_first_factor',
      createdSessionId: null,
    })

    render(<WinWelcomeContent />)
    fireEvent.click(continueButton())

    await waitFor(() =>
      expect(
        screen.getByText(/already been used or has expired/i),
      ).toBeInTheDocument(),
    )
    const loginLink = screen.getByRole('link', { name: /go to login/i })
    expect(loginLink).toHaveAttribute('href', '/login')
    expect(mockSetActive).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })

  it('shows an error with a /login link on load when the ticket is missing', async () => {
    mockSearchParams = new URLSearchParams()

    render(<WinWelcomeContent />)

    await waitFor(() =>
      expect(screen.getByText(/missing its token/i)).toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute(
      'href',
      '/login',
    )
    expect(mockSignInCreate).not.toHaveBeenCalled()
  })

  it('fires Magic Link Clicked once on landing (top of the win funnel) with hasTicket and type:win', async () => {
    render(<WinWelcomeContent />)

    await waitFor(() =>
      expect(trackEventMock).toHaveBeenCalledWith(
        EVENTS.Onboarding.MagicLinkClicked,
        { hasTicket: true, type: 'win' },
      ),
    )
    // Landing-based, fired once on mount regardless of whether the click
    // eventually redeems the ticket.
    const clicked = trackEventMock.mock.calls.filter(
      ([name]) => name === EVENTS.Onboarding.MagicLinkClicked,
    )
    expect(clicked).toHaveLength(1)
  })

  it('reports hasTicket:false when a human lands without a ticket', async () => {
    mockSearchParams = new URLSearchParams()

    render(<WinWelcomeContent />)

    await waitFor(() =>
      expect(trackEventMock).toHaveBeenCalledWith(
        EVENTS.Onboarding.MagicLinkClicked,
        { hasTicket: false, type: 'win' },
      ),
    )
  })
})
