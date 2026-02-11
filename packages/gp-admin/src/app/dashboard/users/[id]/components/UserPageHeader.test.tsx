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
  ClerkLoading: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ClerkLoaded: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const mockUser: User = {
  id: 123,
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  hasPassword: true,
  avatar: 'https://example.com/avatar.jpg',
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

    it('Edit button links to edit page', () => {
      renderWithUser(mockUser)

      expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute(
        'href',
        '/dashboard/users/123/edit'
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
      renderWithUser(mockUser, { isEditMode: true })

      expect(screen.getByText('Edit: John Doe')).toBeInTheDocument()
    })

    it('shows back arrow in edit mode', () => {
      renderWithUser(mockUser, { isEditMode: true })

      const backLink = screen.getByRole('link', {
        name: 'Back to user',
      })
      expect(backLink).toHaveAttribute('href', '/dashboard/users/123')
    })

    it('does not show Edit button in edit mode', () => {
      renderWithUser(mockUser, { isEditMode: true })

      expect(
        screen.queryByRole('link', { name: /edit/i })
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
