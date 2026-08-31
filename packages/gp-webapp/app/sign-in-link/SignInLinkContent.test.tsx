import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import SignInLinkContent from './SignInLinkContent'

const mockSignOut = vi.fn()
const mockSetActive = vi.fn()
const mockSignInCreate = vi.fn()

// `user` mirrors Clerk's active-session signal: truthy (with an `id`) when a
// session is already active in the browser, null on a fresh visit. Exposed via
// a getter so it behaves like the real Clerk singleton's live `.user` — a
// session established mid-redeem is observable from within the same `redeem()`
// closure.
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

const POST_AUTH = '/post-auth-redirect'

// Build a minimal JWT (header.payload.signature) whose payload carries the
// given claims, matching the shape `decodeTicketClaims` parses.
const makeTicket = (claims: Record<string, unknown>): string => {
  const b64 = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.signature`
}

const ticketFor = (sub: string, st = 'sign_in_token') =>
  new URLSearchParams({ __clerk_ticket: makeTicket({ sub, st }) })

const signInButton = () => screen.getByRole('button', { name: /^sign in$/i })

describe('SignInLinkContent', () => {
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
    render(<SignInLinkContent />)

    // The CTA is shown, but nothing is redeemed until the human clicks — this
    // is what protects the one-time ticket from email scanners and unfurlers.
    await waitFor(() => expect(signInButton()).toBeEnabled())
    expect(mockSignInCreate).not.toHaveBeenCalled()
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockSetActive).not.toHaveBeenCalled()
  })

  it('shows an error with a /login link on load when the ticket is missing', async () => {
    mockSearchParams = new URLSearchParams()

    render(<SignInLinkContent />)

    await waitFor(() =>
      expect(screen.getByText(/missing its token/i)).toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute(
      'href',
      '/login',
    )
    expect(mockSignInCreate).not.toHaveBeenCalled()
  })

  it('rejects a Clerk actor (impersonation) token without redeeming it, and does not name the token type', async () => {
    mockSearchParams = ticketFor('user_ticket', 'actor_token')

    render(<SignInLinkContent />)

    await waitFor(() =>
      expect(screen.getByText(/isn’t valid/i)).toBeInTheDocument(),
    )
    // Redeeming an actor token here would silently mint an impersonation
    // session with no banner and no audit affordance.
    expect(mockSignInCreate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^sign in$/i })).toBeNull()
    expect(screen.queryByText(/impersonat/i)).toBeNull()
    expect(screen.queryByText(/actor/i)).toBeNull()
  })

  it('rejects a ticket with no `st` claim at all', async () => {
    mockSearchParams = new URLSearchParams({
      __clerk_ticket: makeTicket({ sub: 'user_ticket' }),
    })

    render(<SignInLinkContent />)

    await waitFor(() =>
      expect(screen.getByText(/isn’t valid/i)).toBeInTheDocument(),
    )
    expect(mockSignInCreate).not.toHaveBeenCalled()
  })

  it('redeems on click with no active session and routes to post-auth with no next param', async () => {
    render(<SignInLinkContent />)

    fireEvent.click(signInButton())

    await waitFor(() =>
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess-1' }),
    )
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockSignInCreate).toHaveBeenCalledWith({
      strategy: 'ticket',
      ticket: mockSearchParams.get('__clerk_ticket'),
    })
    // No `next`: the shared resolver decides where an already-onboarded user
    // belongs, so nobody gets dumped back into onboarding.
    expect(window.location.href).toBe(POST_AUTH)
  })

  it('signs out a different active session (without navigating) before redeeming on click', async () => {
    mockUser = { id: 'user_existing' }
    mockSearchParams = ticketFor('user_other')
    // Assert ordering from within the mock: sign-out must run before redemption.
    mockSignOut.mockImplementation(async () => {
      expect(mockSignInCreate).not.toHaveBeenCalled()
    })

    render(<SignInLinkContent />)
    fireEvent.click(signInButton())

    await waitFor(() =>
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess-1' }),
    )
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    // The no-op callback form is used so Clerk runs the callback instead of its
    // default post-sign-out redirect.
    expect(mockSignOut).toHaveBeenCalledWith(expect.any(Function))
    expect(window.location.href).toBe(POST_AUTH)
  })

  it('skips redemption when already signed in as the ticket user', async () => {
    mockUser = { id: 'user_same' }
    mockSearchParams = ticketFor('user_same')

    render(<SignInLinkContent />)
    fireEvent.click(signInButton())

    await waitFor(() => expect(window.location.href).toBe(POST_AUTH))
    // Same user: we must NOT burn the one-time ticket, and must not error.
    expect(mockSignInCreate).not.toHaveBeenCalled()
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(screen.queryByText(/couldn’t sign you in/i)).not.toBeInTheDocument()
  })

  it('redeems only once on a rapid double-click (does not double-spend the ticket)', async () => {
    render(<SignInLinkContent />)

    const button = signInButton()
    // Two clicks fire before React re-renders the button as disabled.
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() =>
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess-1' }),
    )
    expect(mockSignInCreate).toHaveBeenCalledTimes(1)
  })

  it('shows the consumed message with a /login link when the exchange never completes', async () => {
    mockSignInCreate.mockResolvedValue({
      status: 'needs_first_factor',
      createdSessionId: null,
    })

    render(<SignInLinkContent />)
    fireEvent.click(signInButton())

    await waitFor(() =>
      expect(
        screen.getByText(/already been used or has expired/i),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText(/request a new link/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute(
      'href',
      '/login',
    )
    expect(mockSetActive).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })

  it('shows the consumed message for a genuinely expired/consumed ticket error when not signed in as the ticket user', async () => {
    mockSignInCreate.mockRejectedValue(
      makeClerkApiError(
        'sign_in_token_expired',
        'This sign-in token has expired.',
      ),
    )

    render(<SignInLinkContent />)
    fireEvent.click(signInButton())

    await waitFor(() =>
      expect(
        screen.getByText(/already been used or has expired/i),
      ).toBeInTheDocument(),
    )
    expect(window.location.href).toBe('')
  })

  it('shows a retryable (not consumed) message for a transient non-Clerk error during the exchange', async () => {
    mockSignInCreate.mockRejectedValue(new Error('Network request failed'))

    render(<SignInLinkContent />)
    fireEvent.click(signInButton())

    await waitFor(() =>
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument(),
    )
    expect(
      screen.queryByText(/already been used or has expired/i),
    ).not.toBeInTheDocument()
  })

  it('treats a thrown "already consumed" exchange as success when a session for the ticket user now exists (FAPI auto-retry)', async () => {
    mockSignInCreate.mockImplementation(async () => {
      mockUser = { id: 'user_ticket' }
      throw makeClerkApiError(
        'sign_in_token_already_used',
        'The sign-in token has already been used.',
      )
    })

    render(<SignInLinkContent />)
    fireEvent.click(signInButton())

    await waitFor(() => expect(window.location.href).toBe(POST_AUTH))
    expect(
      screen.queryByText(/already been used or has expired/i),
    ).not.toBeInTheDocument()
  })

  it('navigates to post-auth when setActive fails but a session was nonetheless established', async () => {
    // The ticket exchange completed (ticket spent), setActive keeps throwing,
    // but a session for the ticket user did get established. The user actually
    // signed in, so we must continue — never surface the consumed/expired copy.
    mockSetActive.mockImplementation(async () => {
      mockUser = { id: 'user_ticket' }
      throw new Error('network blip')
    })

    render(<SignInLinkContent />)
    fireEvent.click(signInButton())

    await waitFor(() => expect(window.location.href).toBe(POST_AUTH))
    expect(mockSetActive).toHaveBeenCalledTimes(2)
    expect(
      screen.queryByText(/already been used or has expired/i),
    ).not.toBeInTheDocument()
  })

  it('shows a retryable (not consumed) message when setActive fails and no session was established', async () => {
    mockUser = null
    mockSetActive.mockRejectedValue(new Error('network blip'))

    render(<SignInLinkContent />)
    fireEvent.click(signInButton())

    await waitFor(() =>
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument(),
    )
    expect(mockSetActive).toHaveBeenCalledTimes(2)
    expect(
      screen.queryByText(/already been used or has expired/i),
    ).not.toBeInTheDocument()
    expect(window.location.href).toBe('')
  })

  it('does NOT re-run signIn.create after the exchange has been attempted, even when it fails (guard stays latched, no double-spend)', async () => {
    mockSignInCreate.mockRejectedValue(new Error('network blip'))

    render(<SignInLinkContent />)
    const button = signInButton()
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() =>
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument(),
    )
    expect(mockSignInCreate).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /^sign in$/i })).toBeNull()
  })
})
