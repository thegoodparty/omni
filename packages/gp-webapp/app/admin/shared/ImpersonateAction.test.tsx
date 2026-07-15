import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { useClerk } from '@clerk/nextjs'
import { useSnackbar } from 'helpers/useSnackbar'
import ImpersonateAction from './ImpersonateAction'

const mockClientRequest = vi.fn()
vi.mock('gpApi/typed-request', () => ({
  clientRequest: (...args: unknown[]) => mockClientRequest(...args),
}))

const mockClearElectionResultDismissed = vi.fn()
vi.mock('app/dashboard/election-result/dismissal', () => ({
  clearElectionResultDismissed: () => mockClearElectionResultDismissed(),
}))

const mockSignOut = vi.fn()
const mockSetActive = vi.fn()
const mockSignInCreate = vi.fn()
const mockSuccessSnackbar = vi.fn()
const mockErrorSnackbar = vi.fn()

vi.mock('@clerk/nextjs', () => ({
  useClerk: vi.fn(),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))

const mockSearchMatch = { id: 42, email: 'target@example.com', name: null }

const setLocation = () => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: '' },
  })
}

beforeEach(() => {
  setLocation()

  mockClientRequest.mockReset().mockImplementation((route: string) => {
    if (route === 'GET /v1/admin/users/search') {
      return Promise.resolve({
        ok: true,
        status: 200,
        data: [mockSearchMatch],
      })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      data: { token: 'actor-token-xyz' },
    })
  })

  mockSignOut.mockReset().mockResolvedValue(undefined)
  mockSetActive.mockReset().mockResolvedValue(undefined)
  mockSignInCreate.mockReset().mockResolvedValue({
    status: 'complete',
    createdSessionId: 'session-123',
  })
  mockSuccessSnackbar.mockReset()
  mockErrorSnackbar.mockReset()
  mockClearElectionResultDismissed.mockReset()

  vi.mocked(useClerk).mockReturnValue({
    signOut: mockSignOut,
    client: { signIn: { create: mockSignInCreate } },
    setActive: mockSetActive,
  } as any)
  vi.mocked(useSnackbar).mockReturnValue({
    successSnackbar: mockSuccessSnackbar,
    errorSnackbar: mockErrorSnackbar,
  } as any)
})

describe('ImpersonateAction', () => {
  it('resolves the user id via search, gets a ticket, and redirects to /dashboard for a live candidate', async () => {
    const user = userEvent.setup()
    render(
      <ImpersonateAction
        email="target@example.com"
        isCandidate
        launched="Live"
      />,
    )

    await user.click(screen.getByRole('button', { name: /impersonate/i }))

    await vi.waitFor(() => {
      expect(mockClientRequest).toHaveBeenCalledWith(
        'GET /v1/admin/users/search',
        { email: 'target@example.com' },
      )
    })
    expect(mockClientRequest).toHaveBeenCalledWith(
      'POST /v1/admin/users/impersonate/:userId',
      { userId: '42' },
    )
    await vi.waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled()
    })
    expect(mockSignInCreate).toHaveBeenCalledWith({
      strategy: 'ticket',
      ticket: 'actor-token-xyz',
    })
    expect(mockSetActive).toHaveBeenCalledWith({ session: 'session-123' })
    expect(mockClearElectionResultDismissed).toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(window.location.href).toBe('/dashboard')
    })
  })

  it('redirects to / when not a live candidate', async () => {
    const user = userEvent.setup()
    render(
      <ImpersonateAction
        email="target@example.com"
        isCandidate={false}
        launched="Live"
      />,
    )

    await user.click(screen.getByRole('button', { name: /impersonate/i }))

    await vi.waitFor(() => {
      expect(window.location.href).toBe('/')
    })
  })

  it('shows an error snackbar and does not redirect when the ticket endpoint fails', async () => {
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/admin/users/search') {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: [mockSearchMatch],
        })
      }
      return Promise.resolve({ ok: false, status: 500, data: null })
    })

    const user = userEvent.setup()
    render(
      <ImpersonateAction
        email="target@example.com"
        isCandidate
        launched="Live"
      />,
    )

    await user.click(screen.getByRole('button', { name: /impersonate/i }))

    await vi.waitFor(() => {
      expect(mockErrorSnackbar).toHaveBeenCalledWith('Impersonate failed')
    })
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })

  it('shows an error snackbar and does not redirect when Clerk sign-in does not complete', async () => {
    mockSignInCreate.mockResolvedValue({
      status: 'needs_first_factor',
      createdSessionId: null,
    })

    const user = userEvent.setup()
    render(
      <ImpersonateAction
        email="target@example.com"
        isCandidate
        launched="Live"
      />,
    )

    await user.click(screen.getByRole('button', { name: /impersonate/i }))

    await vi.waitFor(() => {
      expect(mockErrorSnackbar).toHaveBeenCalledWith('Impersonate failed')
    })
    expect(mockSetActive).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })
})
