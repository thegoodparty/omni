import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { clientRequest } from 'gpApi/typed-request'
import TeamInvitePage from './page'

// clientRequest wraps the real implementation by default (so the MSW-backed
// `api.mock` tests below are unaffected) and is overridden per-test only for
// the network-failure case, which needs a rejected promise rather than an
// HTTP status MSW can express.
vi.mock('gpApi/typed-request', async (importActual) => {
  const actual = await importActual<typeof import('gpApi/typed-request')>()
  return { ...actual, clientRequest: vi.fn(actual.clientRequest) }
})

const mockSignOut = vi.fn()
const mockSetActive = vi.fn()
const mockSignInCreate = vi.fn()
const mockSignUpCreate = vi.fn()

let mockUser: { publicMetadata?: unknown } | null = null
let mockIsLoaded = true

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({
    isLoaded: mockIsLoaded,
    user: mockUser,
  }),
  useClerk: () => ({
    client: {
      signUp: { create: mockSignUpCreate },
      signIn: { create: mockSignInCreate },
    },
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
// Clerk API error by the component's error-classification helpers.
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

const mockSetCookie = vi.fn<(name: string, value: string) => void>()
vi.mock('helpers/cookieHelper', () => ({
  getCookie: () => false,
  setCookie: (name: string, value: string) => mockSetCookie(name, value),
  deleteCookie: vi.fn(),
}))

const validMetadata = {
  organizationSlug: 'jane-doe-for-congress',
  role: 'campaignAdmin',
  name: 'Invitee Name',
  invitedByUserId: 7,
}

let hrefAssignments: string[]
let replaceSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockUser = null
  mockIsLoaded = true
  mockSearchParams = new URLSearchParams()
  mockSetCookie.mockClear()
  mockSignOut.mockReset()
  mockSetActive.mockReset().mockResolvedValue(undefined)
  mockSignInCreate.mockReset()
  mockSignUpCreate.mockReset()
  hrefAssignments = []
  replaceSpy = vi.fn()
  // Signed-in sessions without metadata probe gp-api for a pending invite on
  // their verified email (ENG-11027) — default it to none; the fallback
  // tests below override it.
  api.mock('GET /v1/organizations/team/invites/mine', {
    status: 200,
    data: { invite: null },
  })
  // jsdom logs "Not implemented: navigation" on a real assignment; capture
  // the intent instead so the hard-nav-on-accept behavior stays assertable.
  // `href` must still resolve to a real URL (not '') so MSW can resolve the
  // relative '/api/...' request URL against it.
  const initialHref = window.location.href
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      replace: replaceSpy,
      get href() {
        return hrefAssignments[hrefAssignments.length - 1] ?? initialHref
      },
      set href(value: string) {
        hrefAssignments.push(value)
      },
    },
  })
})

const fillTicketForm = () => {
  fireEvent.change(screen.getByLabelText('First name'), {
    target: { value: 'New' },
  })
  fireEvent.change(screen.getByLabelText('Last name'), {
    target: { value: 'Invitee' },
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'a-strong-password-1' },
  })
}

describe('TeamInvitePage', () => {
  it('shows a loading state while Clerk has not resolved the user yet', () => {
    mockIsLoaded = false

    const { container } = render(<TeamInvitePage />)

    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows the neutral no-pending-invitation state when there is no publicMetadata and no pending invitation', async () => {
    mockUser = { publicMetadata: {} }

    render(<TeamInvitePage />)

    expect(await screen.findByText('No pending invitation')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Go to dashboard' }),
    ).toHaveAttribute('href', '/dashboard')
  })

  it('shows the neutral state when publicMetadata fails schema validation', async () => {
    // Missing role/name/invitedByUserId — must never be treated as a valid
    // invite, even though organizationSlug alone looks plausible.
    mockUser = { publicMetadata: { organizationSlug: 'org-one' } }

    render(<TeamInvitePage />)

    expect(await screen.findByText('No pending invitation')).toBeInTheDocument()
  })

  it('renders the invite details from a validated publicMetadata payload', () => {
    mockUser = { publicMetadata: validMetadata }

    render(<TeamInvitePage />)

    expect(screen.getByText(/Jane Doe For Congress/)).toBeInTheDocument()
    expect(screen.getByText(/Campaign Manager/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Accept invitation' }),
    ).toBeInTheDocument()
  })

  it('renders the invite card from the gp-api fallback when publicMetadata is empty (organic signup)', async () => {
    mockUser = { publicMetadata: {} }
    api.mock('GET /v1/organizations/team/invites/mine', {
      status: 200,
      data: {
        invite: {
          organizationSlug: 'jane-doe-for-congress',
          role: 'campaignAdmin',
        },
      },
    })

    render(<TeamInvitePage />)

    expect(await screen.findByText(/Jane Doe For Congress/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Accept invitation' }),
    ).toBeInTheDocument()
  })

  it('accepting sets the org-slug cookie from the response and hard-navigates to /dashboard', async () => {
    mockUser = { publicMetadata: validMetadata }
    api.mock('POST /v1/organizations/team/invites/accept', {
      status: 200,
      data: {
        organizationSlug: 'jane-doe-for-congress',
        role: 'campaignAdmin',
      },
    })

    render(<TeamInvitePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))

    await waitFor(() =>
      expect(mockSetCookie).toHaveBeenCalledWith(
        'organization-slug',
        'jane-doe-for-congress',
      ),
    )
    await waitFor(() => expect(hrefAssignments).toContain('/dashboard'))
  })

  it('a 404 on accept (invite already used) falls back to the neutral state instead of an error', async () => {
    mockUser = { publicMetadata: validMetadata }
    api.mock('POST /v1/organizations/team/invites/accept', {
      status: 404,
      data: { message: 'No pending invitation found' },
    })

    render(<TeamInvitePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))

    await waitFor(() =>
      expect(screen.getByText('No pending invitation')).toBeInTheDocument(),
    )
    expect(mockSetCookie).not.toHaveBeenCalled()
    expect(hrefAssignments).toEqual([])
  })

  it('a non-404 accept failure shows a retryable error without navigating', async () => {
    mockUser = { publicMetadata: validMetadata }
    api.mock('POST /v1/organizations/team/invites/accept', {
      status: 500,
      data: { message: 'down' },
    })

    render(<TeamInvitePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(mockSetCookie).not.toHaveBeenCalled()
    expect(hrefAssignments).toEqual([])
    // The button recovers so the user can retry.
    expect(
      screen.getByRole('button', { name: 'Accept invitation' }),
    ).not.toBeDisabled()
  })

  it('a network failure on accept shows a retryable error instead of leaving the button stuck loading', async () => {
    mockUser = { publicMetadata: validMetadata }
    vi.mocked(clientRequest).mockRejectedValueOnce(new Error('offline'))

    render(<TeamInvitePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(mockSetCookie).not.toHaveBeenCalled()
    expect(hrefAssignments).toEqual([])
    expect(
      screen.getByRole('button', { name: 'Accept invitation' }),
    ).not.toBeDisabled()
  })

  it('signed out with no ticket bounces to /login with the redirect_url the middleware used to set', async () => {
    mockUser = null

    render(<TeamInvitePage />)

    await waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith(
        `/login?redirect_url=${encodeURIComponent('/team-invite')}`,
      ),
    )
  })

  describe('ticket redemption (signed-out invitee)', () => {
    beforeEach(() => {
      mockUser = null
      mockSearchParams = new URLSearchParams({
        __clerk_ticket: 'the-ticket-jwt',
        // Observed as sign_in even for brand-new emails — the page must not
        // branch on it.
        __clerk_status: 'sign_in',
      })
    })

    it('renders the account form and disables Accept until it is filled', () => {
      render(<TeamInvitePage />)

      expect(
        screen.getByText('You’ve been invited to join a campaign team'),
      ).toBeInTheDocument()
      const button = screen.getByRole('button', { name: 'Accept invitation' })
      expect(button).toBeDisabled()
      fillTicketForm()
      expect(button).not.toBeDisabled()
    })

    it('creates the account via the ticket, activates the session, and accepts', async () => {
      mockSignUpCreate.mockResolvedValue({
        status: 'complete',
        createdSessionId: 'sess_new',
      })
      api.mock('POST /v1/organizations/team/invites/accept', {
        status: 200,
        data: {
          organizationSlug: 'jane-doe-for-congress',
          role: 'campaignAdmin',
        },
      })

      render(<TeamInvitePage />)
      fillTicketForm()
      fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))

      await waitFor(() =>
        expect(mockSignUpCreate).toHaveBeenCalledWith({
          strategy: 'ticket',
          ticket: 'the-ticket-jwt',
          firstName: 'New',
          lastName: 'Invitee',
          password: 'a-strong-password-1',
        }),
      )
      await waitFor(() =>
        expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess_new' }),
      )
      await waitFor(() =>
        expect(mockSetCookie).toHaveBeenCalledWith(
          'organization-slug',
          'jane-doe-for-congress',
        ),
      )
      await waitFor(() => expect(hrefAssignments).toContain('/dashboard'))
      expect(mockSignInCreate).not.toHaveBeenCalled()
      // No session was active — nothing to sign out of.
      expect(mockSignOut).not.toHaveBeenCalled()
    })

    it('falls back to ticket sign-in when the invited email already has an account', async () => {
      mockSignUpCreate.mockRejectedValue(
        makeClerkApiError(
          'form_identifier_exists',
          'That email address is taken.',
        ),
      )
      mockSignInCreate.mockResolvedValue({
        status: 'complete',
        createdSessionId: 'sess_existing',
      })
      api.mock('POST /v1/organizations/team/invites/accept', {
        status: 200,
        data: {
          organizationSlug: 'jane-doe-for-congress',
          role: 'campaignAdmin',
        },
      })

      render(<TeamInvitePage />)
      fillTicketForm()
      fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))

      await waitFor(() =>
        expect(mockSignInCreate).toHaveBeenCalledWith({
          strategy: 'ticket',
          ticket: 'the-ticket-jwt',
        }),
      )
      await waitFor(() =>
        expect(mockSetActive).toHaveBeenCalledWith({
          session: 'sess_existing',
        }),
      )
      await waitFor(() => expect(hrefAssignments).toContain('/dashboard'))
    })

    it('a consumed/expired ticket shows the request-a-new-link message, not a generic error', async () => {
      mockSignUpCreate.mockRejectedValue(
        makeClerkApiError('ticket_expired', 'This ticket has expired.'),
      )

      render(<TeamInvitePage />)
      fillTicketForm()
      fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          /already been used or has expired/,
        ),
      )
      expect(hrefAssignments).toEqual([])
    })

    it('surfaces Clerk form errors (e.g. weak password) verbatim so they are actionable', async () => {
      mockSignUpCreate.mockRejectedValue(
        makeClerkApiError(
          'form_password_length_too_short',
          'Passwords must be 8 characters or more.',
        ),
      )

      render(<TeamInvitePage />)
      fillTicketForm()
      fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Passwords must be 8 characters or more.',
        ),
      )
      // The exchange never created an account, so a corrected retry must be
      // possible.
      fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))
      await waitFor(() => expect(mockSignUpCreate).toHaveBeenCalledTimes(2))
    })
  })
})
