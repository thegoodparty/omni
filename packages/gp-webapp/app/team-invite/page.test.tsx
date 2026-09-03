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

let mockUser: { publicMetadata?: unknown } | null = null
let mockIsLoaded = true

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({
    isLoaded: mockIsLoaded,
    user: mockUser,
  }),
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

beforeEach(() => {
  mockUser = null
  mockIsLoaded = true
  mockSetCookie.mockClear()
  hrefAssignments = []
  // jsdom logs "Not implemented: navigation" on a real assignment; capture
  // the intent instead so the hard-nav-on-accept behavior stays assertable.
  // `href` must still resolve to a real URL (not '') so MSW can resolve the
  // relative '/api/...' request URL against it.
  const initialHref = window.location.href
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      get href() {
        return hrefAssignments[hrefAssignments.length - 1] ?? initialHref
      },
      set href(value: string) {
        hrefAssignments.push(value)
      },
    },
  })
})

describe('TeamInvitePage', () => {
  it('shows a loading state while Clerk has not resolved the user yet', () => {
    mockIsLoaded = false

    const { container } = render(<TeamInvitePage />)

    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows the neutral no-pending-invitation state when there is no publicMetadata', () => {
    mockUser = { publicMetadata: {} }

    render(<TeamInvitePage />)

    expect(screen.getByText('No pending invitation')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Go to dashboard' }),
    ).toHaveAttribute('href', '/dashboard')
  })

  it('shows the neutral state when publicMetadata fails schema validation', () => {
    // Missing role/name/invitedByUserId — must never be treated as a valid
    // invite, even though organizationSlug alone looks plausible.
    mockUser = { publicMetadata: { organizationSlug: 'org-one' } }

    render(<TeamInvitePage />)

    expect(screen.getByText('No pending invitation')).toBeInTheDocument()
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
})
