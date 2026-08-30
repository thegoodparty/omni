import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UserPageHeader } from './UserPageHeader'
import { UserProvider } from '../context/UserContext'
import type { User } from '@goodparty_org/sdk'

// Mock Clerk
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

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

vi.mock('../../actions', () => ({
  createImpersonationToken: vi.fn(),
  createSignInLink: vi.fn(),
}))

vi.mock('@/app/dashboard/campaigns/actions', () => ({
  listCampaigns: vi.fn().mockResolvedValue({
    data: [],
    meta: { total: 0, offset: 0, limit: 0 },
  }),
  getCampaignComplianceState: vi.fn(),
  resendCvPin: vi.fn(),
}))

const mockUsePathname = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

const mockUser: User = {
  id: 123,
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  hasPassword: true,
  createdAt: new Date('2024-01-01'),
  avatar: 'https://example.com/avatar.jpg',
  zip: null,
  phone: null,
}

function renderWithUser(user: User, props: { isEditMode?: boolean } = {}) {
  return render(
    <UserProvider user={user}>
      <UserPageHeader {...props} />
    </UserProvider>
  )
}

describe('UserPageHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHas.mockReturnValue(true)
    mockUseAuth.mockReturnValue({
      isSignedIn: true,
      orgId: 'org_123',
      has: mockHas,
    })
    mockUsePathname.mockReturnValue('/dashboard/users/123')
  })

  describe('view mode', () => {
    it('renders user name in heading', () => {
      renderWithUser(mockUser)

      expect(
        screen.getByRole('heading', { name: 'John Doe' })
      ).toBeInTheDocument()
    })

    it('renders Edit button when user has permission', () => {
      renderWithUser(mockUser)

      expect(screen.getByRole('link', { name: /edit/i })).toBeInTheDocument()
    })

    it('Edit button links to edit page on base route', () => {
      renderWithUser(mockUser)

      expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute(
        'href',
        '/dashboard/users/123/edit'
      )
    })

    it('Edit button preserves campaign sub-route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/campaign')

      renderWithUser(mockUser)

      expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute(
        'href',
        '/dashboard/users/123/edit/campaign'
      )
    })

    it('Edit button preserves elected-office sub-route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/elected-office')

      renderWithUser(mockUser)

      expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute(
        'href',
        '/dashboard/users/123/edit/elected-office'
      )
    })

    it('does not show back arrow in view mode', () => {
      renderWithUser(mockUser)

      // Back arrow would be a link to the user page, not edit
      const links = screen.getAllByRole('link')
      const backLink = links.find((link) =>
        link.getAttribute('href')?.endsWith('/123')
      )
      expect(backLink).toBeUndefined()
    })
  })

  describe('edit mode', () => {
    it('renders user name with Edit prefix', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/edit')

      renderWithUser(mockUser, { isEditMode: true })

      expect(screen.getByText('Edit: John Doe')).toBeInTheDocument()
    })

    it('back arrow links to view page on base edit route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/edit')

      renderWithUser(mockUser, { isEditMode: true })

      const backLink = screen.getByRole('link', {
        name: 'Back to user',
      })
      expect(backLink).toHaveAttribute('href', '/dashboard/users/123')
    })

    it('back arrow preserves campaign sub-route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/edit/campaign')

      renderWithUser(mockUser, { isEditMode: true })

      const backLink = screen.getByRole('link', {
        name: 'Back to user',
      })
      expect(backLink).toHaveAttribute('href', '/dashboard/users/123/campaign')
    })

    it('back arrow preserves elected-office sub-route', () => {
      mockUsePathname.mockReturnValue(
        '/dashboard/users/123/edit/elected-office'
      )

      renderWithUser(mockUser, { isEditMode: true })

      const backLink = screen.getByRole('link', {
        name: 'Back to user',
      })
      expect(backLink).toHaveAttribute(
        'href',
        '/dashboard/users/123/elected-office'
      )
    })

    it('does not show Edit button in edit mode', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/edit')

      renderWithUser(mockUser, { isEditMode: true })

      expect(
        screen.queryByRole('link', { name: /edit/i })
      ).not.toBeInTheDocument()
    })
  })

  describe('impersonate button', () => {
    it('renders ImpersonateButton in view mode', () => {
      renderWithUser(mockUser)

      expect(
        screen.getByRole('button', { name: /impersonate/i })
      ).toBeInTheDocument()
    })

    it('does not render ImpersonateButton in edit mode', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/edit')

      renderWithUser(mockUser, { isEditMode: true })

      expect(
        screen.queryByRole('button', { name: /impersonate/i })
      ).not.toBeInTheDocument()
    })

    it('hides ImpersonateButton when user lacks IMPERSONATE_USERS permission', () => {
      mockHas.mockReturnValue(false)

      renderWithUser(mockUser)

      expect(
        screen.queryByRole('button', { name: /impersonate/i })
      ).not.toBeInTheDocument()
    })

    it('renders SignInLinkButton in view mode', () => {
      renderWithUser(mockUser)

      expect(
        screen.getByRole('button', { name: /sign-in link/i })
      ).toBeInTheDocument()
    })

    it('does not render SignInLinkButton in edit mode', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/edit')

      renderWithUser(mockUser, { isEditMode: true })

      expect(
        screen.queryByRole('button', { name: /sign-in link/i })
      ).not.toBeInTheDocument()
    })

    it('still shows SignInLinkButton when ImpersonateButton is hidden', () => {
      mockHas.mockReturnValue(false)

      renderWithUser(mockUser)

      expect(
        screen.getByRole('button', { name: /sign-in link/i })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /impersonate/i })
      ).not.toBeInTheDocument()
    })

    it('still shows Edit button when ImpersonateButton is hidden', () => {
      mockHas.mockImplementation(
        ({ permission }: { permission?: string; role?: string }) =>
          permission !== 'org:admin_portal:impersonate_users'
      )

      renderWithUser(mockUser)

      expect(screen.getByRole('link', { name: /edit/i })).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /impersonate/i })
      ).not.toBeInTheDocument()
    })
  })

  describe('edge cases', () => {
    it('renders without crashing when avatar is missing', () => {
      renderWithUser({ ...mockUser, avatar: null })

      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('renders without crashing when name and avatar are missing', () => {
      renderWithUser({ ...mockUser, name: null, avatar: null })

      // Component should render without throwing
      expect(screen.getByRole('link', { name: /edit/i })).toBeInTheDocument()
    })

    it('uses "U" avatar fallback when firstName is undefined', () => {
      // @ts-expect-error testing defensive fallback when firstName is absent at runtime
      renderWithUser({ ...mockUser, firstName: undefined, avatar: null })

      // Avatar fallback path (firstName?.[0] ?? 'U') is exercised
      expect(screen.getByRole('heading')).toBeInTheDocument()
    })
  })
})
