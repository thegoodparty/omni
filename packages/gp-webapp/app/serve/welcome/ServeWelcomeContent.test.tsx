import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ServeWelcomeContent from './ServeWelcomeContent'
import { SERVE_ONBOARDING_PATH } from 'helpers/resolvePostAuthRedirectPath.util'

const mockSignOut = vi.fn()
const mockSetActive = vi.fn()
const mockSignInCreate = vi.fn()

// `user` mirrors Clerk's active-session signal: truthy when a session is
// already active in the browser, null on a fresh visit.
let mockUser: unknown = null

vi.mock('@clerk/nextjs', () => ({
  useClerk: () => ({
    client: { signIn: { create: mockSignInCreate } },
    setActive: mockSetActive,
    signOut: mockSignOut,
    loaded: true,
    user: mockUser,
  }),
}))

let mockSearchParams = new URLSearchParams({ __clerk_ticket: 'ticket-abc' })
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

const POST_AUTH = `/post-auth-redirect?next=${encodeURIComponent(
  SERVE_ONBOARDING_PATH,
)}`

describe('ServeWelcomeContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = null
    mockSearchParams = new URLSearchParams({ __clerk_ticket: 'ticket-abc' })
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

  it('redeems the ticket and routes to post-auth without signing out on a fresh visit', async () => {
    render(<ServeWelcomeContent />)

    await waitFor(() =>
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess-1' }),
    )
    // No active session means the happy path is unchanged — we must NOT sign
    // out (and therefore never risk Clerk's post-sign-out navigation).
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockSignInCreate).toHaveBeenCalledWith({
      strategy: 'ticket',
      ticket: 'ticket-abc',
    })
    expect(window.location.href).toBe(POST_AUTH)
  })

  it('signs out an existing session (without navigating) before redeeming, then routes to post-auth', async () => {
    mockUser = { id: 'user_existing' }
    // Assert ordering from within the mock: sign-out must run before redemption.
    mockSignOut.mockImplementation(async () => {
      expect(mockSignInCreate).not.toHaveBeenCalled()
    })

    render(<ServeWelcomeContent />)

    await waitFor(() =>
      expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess-1' }),
    )
    // An active session is cleared first, and the no-op callback form is used
    // so Clerk runs the callback instead of its default redirect.
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(mockSignOut).toHaveBeenCalledWith(expect.any(Function))
    expect(window.location.href).toBe(POST_AUTH)
    expect(screen.queryByText(/couldn’t sign you in/i)).not.toBeInTheDocument()
  })

  it('proceeds without error when the active session is already the ticket user', async () => {
    // Same user already signed in: the flow re-establishes the session via the
    // ticket and routes through normally — it must not surface an error.
    mockUser = { id: 'user_same' }

    render(<ServeWelcomeContent />)

    await waitFor(() => expect(window.location.href).toBe(POST_AUTH))
    expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess-1' })
    expect(screen.queryByText(/couldn’t sign you in/i)).not.toBeInTheDocument()
  })

  it('continues redeeming when the pre-redemption sign-out hiccups', async () => {
    mockUser = { id: 'user_existing' }
    mockSignOut.mockRejectedValue(new Error('network blip'))

    render(<ServeWelcomeContent />)

    // A transient sign-out failure must not strand the recipient.
    await waitFor(() => expect(window.location.href).toBe(POST_AUTH))
    expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess-1' })
    expect(screen.queryByText(/couldn’t sign you in/i)).not.toBeInTheDocument()
  })

  it('falls back to /login on an unrecoverable redemption error', async () => {
    mockSignInCreate.mockResolvedValue({
      status: 'needs_first_factor',
      createdSessionId: null,
    })

    render(<ServeWelcomeContent />)

    await waitFor(() =>
      expect(screen.getByText(/couldn’t sign you in/i)).toBeInTheDocument(),
    )
    const loginLink = screen.getByRole('link', { name: /go to login/i })
    expect(loginLink).toHaveAttribute('href', '/login')
    expect(mockSetActive).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })

  it('shows an error when the link is missing its ticket', async () => {
    mockSearchParams = new URLSearchParams()

    render(<ServeWelcomeContent />)

    await waitFor(() =>
      expect(
        screen.getByText(/missing its sign-in token/i),
      ).toBeInTheDocument(),
    )
    expect(mockSignInCreate).not.toHaveBeenCalled()
  })
})
