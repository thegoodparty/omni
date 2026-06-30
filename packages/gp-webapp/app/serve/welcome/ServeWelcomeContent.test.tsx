import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ServeWelcomeContent from './ServeWelcomeContent'
import { SERVE_ONBOARDING_PATH } from 'helpers/resolvePostAuthRedirectPath.util'

const mockSignOut = vi.fn()
const mockSetActive = vi.fn()
const mockSignInCreate = vi.fn()

// `user` mirrors Clerk's active-session signal: truthy (with an `id`) when a
// session is already active in the browser, null on a fresh visit. Exposed via
// a getter so it behaves like the real Clerk singleton's live `.user` — a
// session established mid-redeem (e.g. the ticket exchange succeeded but a
// later step threw) is observable from within the same `redeem()` closure.
let mockUser: { id: string } | null = null

vi.mock('@clerk/nextjs', () => ({
  useClerk: () => ({
    client: { signIn: { create: mockSignInCreate } },
    setActive: mockSetActive,
    signOut: mockSignOut,
    loaded: true,
    get user() {
      return mockUser
    },
  }),
}))

// `isClerkAPIResponseError` matches when the error's constructor exposes
// `kind === 'ClerkAPIResponseError'`, so this stand-in is recognized as a real
// Clerk API error by the component's error-classification helper.
class FakeClerkAPIResponseError extends Error {
  static kind = 'ClerkAPIResponseError'
  clerkError = true
  errors: { code: string; message: string; longMessage: string }[]
  constructor(
    errors: { code: string; message: string; longMessage: string }[],
  ) {
    super('clerk api response error')
    this.name = 'ClerkAPIResponseError'
    this.errors = errors
  }
}

const makeClerkApiError = (code: string, message: string) =>
  new FakeClerkAPIResponseError([{ code, message, longMessage: message }])

let mockSearchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
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
  SERVE_ONBOARDING_PATH,
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

describe('ServeWelcomeContent', () => {
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
    // The component navigates via window.location.href; stub it so jsdom does
    // not attempt a real navigation.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    })
  })

  it('renders the landing page and does NOT redeem on load (prefetch / Safe-Links safe)', async () => {
    render(<ServeWelcomeContent />)

    // The CTA is shown, but nothing is redeemed until the human clicks — this
    // is what protects the one-time ticket from email scanners and unfurlers.
    await waitFor(() => expect(continueButton()).toBeEnabled())
    expect(mockSignInCreate).not.toHaveBeenCalled()
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockSetActive).not.toHaveBeenCalled()
  })

  it('redeems on click with no active session and routes to post-auth', async () => {
    render(<ServeWelcomeContent />)

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

  it('signs out a different active session (without navigating) before redeeming on click', async () => {
    mockUser = { id: 'user_existing' }
    mockSearchParams = ticketFor('user_other')
    // Assert ordering from within the mock: sign-out must run before redemption.
    mockSignOut.mockImplementation(async () => {
      expect(mockSignInCreate).not.toHaveBeenCalled()
    })

    render(<ServeWelcomeContent />)
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
    render(<ServeWelcomeContent />)

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

    render(<ServeWelcomeContent />)
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

    render(<ServeWelcomeContent />)
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

  it('navigates to post-auth when setActive fails but a session was nonetheless established (post-exchange failure is never an expired link)', async () => {
    // The ticket exchange completed (ticket spent), setActive keeps throwing,
    // but a session for the ticket user did get established. The user actually
    // signed in, so we must continue — never surface the consumed/expired copy.
    mockSetActive.mockImplementation(async () => {
      mockUser = { id: 'user_ticket' }
      throw new Error('network blip')
    })

    render(<ServeWelcomeContent />)
    fireEvent.click(continueButton())

    await waitFor(() => expect(window.location.href).toBe(POST_AUTH))
    // setActive is retried once before we proceed to the redirect.
    expect(mockSetActive).toHaveBeenCalledTimes(2)
    expect(
      screen.queryByText(/already been used or has expired/i),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  it('shows a retryable (not consumed) message when setActive fails and no session was established', async () => {
    // setActive establishes the active-session cookie; if it fully fails and no
    // session exists, the user is not actually signed in. We must not silently
    // bounce them to login — show the retryable message, never the consumed
    // copy, and do not navigate.
    mockUser = null
    mockSetActive.mockRejectedValue(new Error('network blip'))

    render(<ServeWelcomeContent />)
    fireEvent.click(continueButton())

    await waitFor(() =>
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument(),
    )
    expect(mockSetActive).toHaveBeenCalledTimes(2)
    expect(
      screen.queryByText(/already been used or has expired/i),
    ).not.toBeInTheDocument()
    expect(window.location.href).toBe('')
  })

  it('treats a thrown "already consumed" exchange as success when a session for the ticket user now exists (FAPI auto-retry)', async () => {
    // clerk-js can auto-retry the exchange POST after a transient blip; the
    // first attempt already consumed the ticket AND established the session, so
    // the retry throws "already consumed" even though sign-in succeeded. Mirror
    // that by flipping the active user to the ticket's user as the throw fires.
    mockSignInCreate.mockImplementation(async () => {
      mockUser = { id: 'user_ticket' }
      throw makeClerkApiError(
        'sign_in_token_already_used',
        'The sign-in token has already been used.',
      )
    })

    render(<ServeWelcomeContent />)
    fireEvent.click(continueButton())

    await waitFor(() => expect(window.location.href).toBe(POST_AUTH))
    expect(
      screen.queryByText(/already been used or has expired/i),
    ).not.toBeInTheDocument()
  })

  it('treats a thrown "already consumed" exchange as success when a session appears but the ticket is not a decodable JWT (FAPI auto-retry, non-standard ticket)', async () => {
    // A ticket that is not a standard three-part JWT — decodeTicketUserId
    // returns null, so the recovery check can't compare user ids. A session
    // that appears during the redeem (the exchange's first attempt succeeded
    // before the auto-retry threw "already consumed") must still be recognized
    // as success rather than mislabeled as a consumed link.
    mockUser = null
    mockSearchParams = new URLSearchParams({ __clerk_ticket: 'not-a-jwt' })
    mockSignInCreate.mockImplementation(async () => {
      mockUser = { id: 'user_ticket' }
      throw makeClerkApiError(
        'sign_in_token_already_used',
        'The sign-in token has already been used.',
      )
    })

    render(<ServeWelcomeContent />)
    fireEvent.click(continueButton())

    await waitFor(() => expect(window.location.href).toBe(POST_AUTH))
    expect(
      screen.queryByText(/already been used or has expired/i),
    ).not.toBeInTheDocument()
  })

  it('treats a non-complete exchange result as success when a session for the ticket user was nonetheless established (FAPI internal retry)', async () => {
    mockUser = null
    // The (internally retried) exchange comes back incomplete, but the first
    // attempt already established the session for the ticket user. We must
    // recover instead of declaring the link consumed.
    mockSignInCreate.mockImplementation(async () => {
      mockUser = { id: 'user_ticket' }
      return { status: 'needs_first_factor', createdSessionId: null }
    })

    render(<ServeWelcomeContent />)
    fireEvent.click(continueButton())

    await waitFor(() => expect(window.location.href).toBe(POST_AUTH))
    expect(mockSetActive).not.toHaveBeenCalled()
    expect(
      screen.queryByText(/already been used or has expired/i),
    ).not.toBeInTheDocument()
  })

  it('does NOT re-run signIn.create after the exchange has been attempted, even when it fails (guard stays latched, no double-spend)', async () => {
    mockSignInCreate.mockRejectedValue(new Error('network blip'))

    render(<ServeWelcomeContent />)
    const button = continueButton()
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() =>
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument(),
    )
    // The one-time ticket exchange is attempted at most once, and no Continue
    // button remains, so a frustrated user cannot re-fire it on a spent ticket.
    expect(mockSignInCreate).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole('button', { name: /continue to goodparty/i }),
    ).not.toBeInTheDocument()
  })

  it('shows the consumed message for a genuinely expired/consumed ticket error when not signed in as the ticket user', async () => {
    mockSignInCreate.mockRejectedValue(
      makeClerkApiError(
        'sign_in_token_expired',
        'This sign-in token has expired.',
      ),
    )

    render(<ServeWelcomeContent />)
    fireEvent.click(continueButton())

    await waitFor(() =>
      expect(
        screen.getByText(/already been used or has expired/i),
      ).toBeInTheDocument(),
    )
    expect(window.location.href).toBe('')
  })

  it('shows a retryable (not consumed) message for a transient non-Clerk error during the exchange', async () => {
    mockSignInCreate.mockRejectedValue(new Error('Network request failed'))

    render(<ServeWelcomeContent />)
    fireEvent.click(continueButton())

    await waitFor(() =>
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument(),
    )
    expect(
      screen.queryByText(/already been used or has expired/i),
    ).not.toBeInTheDocument()
  })

  it('shows an error with a /login link on load when the ticket is missing', async () => {
    mockSearchParams = new URLSearchParams()

    render(<ServeWelcomeContent />)

    await waitFor(() =>
      expect(screen.getByText(/missing its token/i)).toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute(
      'href',
      '/login',
    )
    expect(mockSignInCreate).not.toHaveBeenCalled()
  })

  it('fires Magic Link Clicked once on landing (top of the serve funnel) with hasTicket and type:serve', async () => {
    render(<ServeWelcomeContent />)

    await waitFor(() =>
      expect(trackEventMock).toHaveBeenCalledWith(
        EVENTS.Onboarding.MagicLinkClicked,
        { hasTicket: true, type: 'serve' },
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

    render(<ServeWelcomeContent />)

    await waitFor(() =>
      expect(trackEventMock).toHaveBeenCalledWith(
        EVENTS.Onboarding.MagicLinkClicked,
        { hasTicket: false, type: 'serve' },
      ),
    )
  })
})
