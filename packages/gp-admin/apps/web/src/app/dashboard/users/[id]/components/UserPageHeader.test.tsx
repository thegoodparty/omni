import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UserPageHeader } from './UserPageHeader'
import type { UserHeaderData } from '../types'

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

const mockUser: UserHeaderData = {
  id: 123,
  name: 'John Doe',
  avatar: 'https://example.com/avatar.jpg',
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
      render(<UserPageHeader user={mockUser} />)

      expect(
        screen.getByRole('heading', { name: 'John Doe' })
      ).toBeInTheDocument()
    })

    it('renders Edit button when user has permission', () => {
      render(<UserPageHeader user={mockUser} />)

      expect(screen.getByRole('link', { name: /edit/i })).toBeInTheDocument()
    })

    it('Edit button links to edit page', () => {
      render(<UserPageHeader user={mockUser} />)

      expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute(
        'href',
        '/dashboard/users/123/edit'
      )
    })

    it('does not show back arrow in view mode', () => {
      render(<UserPageHeader user={mockUser} />)

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
      render(<UserPageHeader user={mockUser} isEditMode />)

      expect(screen.getByText('Edit: John Doe')).toBeInTheDocument()
    })

    it('shows back arrow in edit mode', () => {
      render(<UserPageHeader user={mockUser} isEditMode />)

      const backLink = screen.getByRole('link', {
        name: '', // Icon link has no text
      })
      expect(backLink).toHaveAttribute('href', '/dashboard/users/123')
    })

    it('does not show Edit button in edit mode', () => {
      render(<UserPageHeader user={mockUser} isEditMode />)

      expect(
        screen.queryByRole('link', { name: /edit/i })
      ).not.toBeInTheDocument()
    })
  })

  describe('edge cases', () => {
    it('renders without crashing when avatar is missing', () => {
      const userNoAvatar: UserHeaderData = {
        id: 456,
        name: 'Jane Smith',
        avatar: null,
      }

      render(<UserPageHeader user={userNoAvatar} />)

      expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    })

    it('renders without crashing when name and avatar are missing', () => {
      const userNoName: UserHeaderData = {
        id: 789,
        name: null,
        avatar: null,
      }

      render(<UserPageHeader user={userNoName} />)

      // Component should render without throwing
      expect(screen.getByRole('link', { name: /edit/i })).toBeInTheDocument()
    })
  })
})
