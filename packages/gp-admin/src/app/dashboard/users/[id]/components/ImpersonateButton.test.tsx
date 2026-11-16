import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { ImpersonateButton } from './ImpersonateButton'
import { PERMISSIONS } from '@/lib/permissions'
import { UserProvider } from '../context/UserContext'
import type { User } from '@/shared/gpApi'

// --- Clerk mock ---
const mockHas = vi.fn()
const mockUseAuth = vi.fn()

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => mockUseAuth(),
  useClerk: () => ({
    loaded: false,
    signOut: vi.fn(),
    setActive: vi.fn(),
    client: { signIn: { create: vi.fn() } },
  }),
  useSignIn: () => ({ signIn: null, setActive: vi.fn() }),
  ClerkLoading: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ClerkLoaded: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// --- Toast mock ---
const mockShowToast = vi.fn()
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}))

// --- Server action mock ---
const mockCreateImpersonationToken = vi.fn()
vi.mock('../../actions', () => ({
  createImpersonationToken: (...args: unknown[]) =>
    mockCreateImpersonationToken(...args),
}))

// --- window.open mock ---
const mockAssign = vi.fn()
vi.stubGlobal('open', mockAssign)

const mockUser: User = {
  id: 42,
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  hasPassword: true,
  createdAt: new Date('2024-01-01'),
  avatar: null,
  zip: null,
  phone: null,
}

function renderButton(userId = 42, clerkBanned = false) {
  return render(
    <Theme>
      <UserProvider user={mockUser} clerkBanned={clerkBanned}>
        <ImpersonateButton userId={userId} />
      </UserProvider>
    </Theme>
  )
}

describe('ImpersonateButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHas.mockReturnValue(true)
    mockUseAuth.mockReturnValue({
      isSignedIn: true,
      orgId: 'org_123',
      has: mockHas,
    })
  })

  describe('visibility', () => {
    it('renders button when user has IMPERSONATE_USERS permission', () => {
      mockHas.mockImplementation(
        ({ permission }: { permission: string }) =>
          permission === PERMISSIONS.IMPERSONATE_USERS
      )

      renderButton()

      expect(
        screen.getByRole('button', { name: /impersonate/i })
      ).toBeInTheDocument()
    })

    it('does not render button when user lacks IMPERSONATE_USERS permission', () => {
      mockHas.mockReturnValue(false)

      renderButton()

      expect(
        screen.queryByRole('button', { name: /impersonate/i })
      ).not.toBeInTheDocument()
    })

    it('checks the correct permission', () => {
      renderButton()

      expect(mockHas).toHaveBeenCalledWith({
        permission: PERMISSIONS.IMPERSONATE_USERS,
      })
    })
  })

  describe('default state', () => {
    it('shows Impersonate label', () => {
      renderButton()

      expect(
        screen.getByRole('button', { name: /impersonate/i })
      ).toHaveTextContent('Impersonate')
    })

    it('is not disabled', () => {
      renderButton()

      expect(
        screen.getByRole('button', { name: /impersonate/i })
      ).not.toBeDisabled()
    })
  })

  describe('on click — success', () => {
    it('calls createImpersonationToken with the correct userId', async () => {
      mockCreateImpersonationToken.mockResolvedValue({ token: 'tok_abc' })

      renderButton(99)
      await userEvent.click(
        screen.getByRole('button', { name: /impersonate/i })
      )

      expect(mockCreateImpersonationToken).toHaveBeenCalledWith(99)
    })

    it('redirects to webapp with the returned token', async () => {
      mockCreateImpersonationToken.mockResolvedValue({ token: 'tok_abc' })

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /impersonate/i })
      )

      await waitFor(() => {
        expect(mockAssign).toHaveBeenCalledWith(
          expect.stringContaining('__clerk_ticket=tok_abc'),
          '_blank'
        )
      })
    })

    it('redirects to the /impersonate path', async () => {
      mockCreateImpersonationToken.mockResolvedValue({ token: 'tok_abc' })

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /impersonate/i })
      )

      await waitFor(() => {
        expect(mockAssign).toHaveBeenCalledWith(
          expect.stringContaining('/impersonate'),
          '_blank'
        )
      })
    })

    it('does not show a toast on success', async () => {
      mockCreateImpersonationToken.mockResolvedValue({ token: 'tok_abc' })

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /impersonate/i })
      )

      await waitFor(() => expect(mockAssign).toHaveBeenCalled())
      expect(mockShowToast).not.toHaveBeenCalled()
    })
  })

  describe('on click — loading state', () => {
    it('shows Impersonating... while the request is in-flight', async () => {
      let resolve: (value: { token: string }) => void
      mockCreateImpersonationToken.mockReturnValue(
        new Promise<{ token: string }>((res) => {
          resolve = res
        })
      )

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /impersonate/i })
      )

      expect(
        await screen.findByRole('button', { name: /impersonating/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /impersonating/i })
      ).toBeDisabled()

      // Clean up pending promise
      resolve!({ token: 'done' })
    })

    it('re-enables the button after a successful request', async () => {
      mockCreateImpersonationToken.mockResolvedValue({ token: 'tok_abc' })

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /impersonate/i })
      )

      await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled())
    })
  })

  describe('on click — error', () => {
    it('shows the error message in a toast when the action throws an Error', async () => {
      mockCreateImpersonationToken.mockRejectedValue(
        new Error('Missing impersonate permission')
      )

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /impersonate/i })
      )

      await waitFor(() =>
        expect(mockShowToast).toHaveBeenCalledWith(
          'Missing impersonate permission'
        )
      )
    })

    it('shows generic fallback toast for non-Error throws', async () => {
      mockCreateImpersonationToken.mockRejectedValue('unexpected string error')

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /impersonate/i })
      )

      await waitFor(() =>
        expect(mockShowToast).toHaveBeenCalledWith('Failed to impersonate user')
      )
    })

    it('re-enables the button after a failed request', async () => {
      mockCreateImpersonationToken.mockRejectedValue(new Error('fail'))

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /impersonate/i })
      )

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /impersonate/i })
        ).not.toBeDisabled()
      )
    })

    it('does not redirect on error', async () => {
      mockCreateImpersonationToken.mockRejectedValue(new Error('fail'))

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /impersonate/i })
      )

      await waitFor(() => expect(mockShowToast).toHaveBeenCalled())
      expect(mockAssign).not.toHaveBeenCalled()
    })

    it('shows the API reason when the action reports a banned target', async () => {
      mockCreateImpersonationToken.mockResolvedValue({
        token: null,
        webappUrl: 'https://app.goodparty.org',
        error: 'Clerk has this account banned',
      })

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /impersonate/i })
      )

      await waitFor(() =>
        expect(mockShowToast).toHaveBeenCalledWith(
          'Clerk has this account banned'
        )
      )
      expect(mockAssign).not.toHaveBeenCalled()
    })
  })

  describe('banned target', () => {
    it('shows a banned badge next to the button', () => {
      renderButton(42, true)

      expect(screen.getByText('Banned in Clerk')).toBeInTheDocument()
    })

    it('does not offer the click', () => {
      renderButton(42, true)

      expect(
        screen.getByRole('button', { name: /impersonate/i })
      ).toBeDisabled()
    })

    it('renders no badge for an unbanned account', () => {
      renderButton()

      expect(screen.queryByText('Banned in Clerk')).toBeNull()
    })
  })
})
