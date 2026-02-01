import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProtectedContent } from './ProtectedContent'
import { PERMISSIONS, ROLES } from '@/lib/permissions'

// Create a mock function that we can control per test
const mockHas = vi.fn()
const mockUseAuth = vi.fn()

// Mock Clerk
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => mockUseAuth(),
  ClerkLoading: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="clerk-loading">{children}</div>
  ),
  ClerkLoaded: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="clerk-loaded">{children}</div>
  ),
}))

describe('ProtectedContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHas.mockReset()
    mockUseAuth.mockReset()
  })

  describe('loading state', () => {
    it('shows loading spinner during Clerk loading', () => {
      mockUseAuth.mockReturnValue({
        isSignedIn: true,
        orgId: 'org_123',
        has: mockHas,
      })

      render(
        <ProtectedContent>
          <div>Content</div>
        </ProtectedContent>
      )

      expect(screen.getByTestId('clerk-loading')).toBeInTheDocument()
    })

    it('hides loading spinner when hideWhenUnauthorized is true', () => {
      mockUseAuth.mockReturnValue({
        isSignedIn: true,
        orgId: 'org_123',
        has: mockHas,
      })

      render(
        <ProtectedContent hideWhenUnauthorized>
          <div>Content</div>
        </ProtectedContent>
      )

      const loadingDiv = screen.getByTestId('clerk-loading')
      expect(loadingDiv.children.length).toBe(0)
    })
  })

  describe('not signed in', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isSignedIn: false,
        orgId: null,
        has: mockHas,
      })
    })

    it('shows sign-in message', () => {
      render(
        <ProtectedContent>
          <div>Secret content</div>
        </ProtectedContent>
      )

      expect(
        screen.getByText('You must be signed in to view this content.')
      ).toBeInTheDocument()
      expect(screen.queryByText('Secret content')).not.toBeInTheDocument()
    })

    it('hides everything when hideWhenUnauthorized is true', () => {
      render(
        <ProtectedContent hideWhenUnauthorized>
          <div>Secret content</div>
        </ProtectedContent>
      )

      const loadedContent = screen.getByTestId('clerk-loaded')
      expect(loadedContent.textContent).toBe('')
    })

    it('shows custom fallback instead of default message', () => {
      render(
        <ProtectedContent fallback={<div>Custom unauthorized message</div>}>
          <div>Secret content</div>
        </ProtectedContent>
      )

      expect(
        screen.getByText('Custom unauthorized message')
      ).toBeInTheDocument()
      expect(
        screen.queryByText('You must be signed in to view this content.')
      ).not.toBeInTheDocument()
    })
  })

  describe('no organization selected', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isSignedIn: true,
        orgId: null,
        has: mockHas,
      })
    })

    it('shows organization selection message', () => {
      render(
        <ProtectedContent>
          <div>Secret content</div>
        </ProtectedContent>
      )

      expect(
        screen.getByText('Please select an organization to continue.')
      ).toBeInTheDocument()
    })

    it('hides everything when hideWhenUnauthorized is true', () => {
      render(
        <ProtectedContent hideWhenUnauthorized>
          <div>Secret content</div>
        </ProtectedContent>
      )

      const loadedContent = screen.getByTestId('clerk-loaded')
      expect(loadedContent.textContent).toBe('')
    })

    it('shows custom fallback for no org', () => {
      render(
        <ProtectedContent fallback={<div>Please select org</div>}>
          <div>Secret content</div>
        </ProtectedContent>
      )

      expect(screen.getByText('Please select org')).toBeInTheDocument()
    })
  })

  describe('permission checks', () => {
    it('renders children when user has required permission', () => {
      mockHas.mockReturnValue(true)
      mockUseAuth.mockReturnValue({
        isSignedIn: true,
        orgId: 'org_123',
        has: mockHas,
      })

      render(
        <ProtectedContent requiredPermission={PERMISSIONS.WRITE_USERS}>
          <div>Admin content</div>
        </ProtectedContent>
      )

      expect(screen.getByText('Admin content')).toBeInTheDocument()
      expect(mockHas).toHaveBeenCalledWith({
        permission: PERMISSIONS.WRITE_USERS,
      })
    })

    it('shows permission error when user lacks permission', () => {
      mockHas.mockReturnValue(false)
      mockUseAuth.mockReturnValue({
        isSignedIn: true,
        orgId: 'org_123',
        has: mockHas,
      })

      render(
        <ProtectedContent requiredPermission={PERMISSIONS.WRITE_USERS}>
          <div>Admin content</div>
        </ProtectedContent>
      )

      expect(
        screen.getByText("You don't have permission to view this content.")
      ).toBeInTheDocument()
    })

    it('hides when lacking permission and hideWhenUnauthorized is true', () => {
      mockHas.mockReturnValue(false)
      mockUseAuth.mockReturnValue({
        isSignedIn: true,
        orgId: 'org_123',
        has: mockHas,
      })

      render(
        <ProtectedContent
          requiredPermission={PERMISSIONS.WRITE_USERS}
          hideWhenUnauthorized
        >
          <div>Admin content</div>
        </ProtectedContent>
      )

      const loadedContent = screen.getByTestId('clerk-loaded')
      expect(loadedContent.textContent).toBe('')
    })

    it('shows custom fallback when lacking permission', () => {
      mockHas.mockReturnValue(false)
      mockUseAuth.mockReturnValue({
        isSignedIn: true,
        orgId: 'org_123',
        has: mockHas,
      })

      render(
        <ProtectedContent
          requiredPermission={PERMISSIONS.WRITE_USERS}
          fallback={<div>No access</div>}
        >
          <div>Admin content</div>
        </ProtectedContent>
      )

      expect(screen.getByText('No access')).toBeInTheDocument()
    })
  })

  describe('role checks', () => {
    it('renders children when user has required role', () => {
      mockHas.mockReturnValue(true)
      mockUseAuth.mockReturnValue({
        isSignedIn: true,
        orgId: 'org_123',
        has: mockHas,
      })

      render(
        <ProtectedContent requiredRole={ROLES.ADMIN}>
          <div>Admin panel</div>
        </ProtectedContent>
      )

      expect(screen.getByText('Admin panel')).toBeInTheDocument()
      expect(mockHas).toHaveBeenCalledWith({ role: ROLES.ADMIN })
    })

    it('shows role error when user lacks role', () => {
      mockHas.mockReturnValue(false)
      mockUseAuth.mockReturnValue({
        isSignedIn: true,
        orgId: 'org_123',
        has: mockHas,
      })

      render(
        <ProtectedContent requiredRole={ROLES.ADMIN}>
          <div>Admin panel</div>
        </ProtectedContent>
      )

      expect(
        screen.getByText(
          "You don't have the required role to view this content."
        )
      ).toBeInTheDocument()
    })

    it('hides when lacking role and hideWhenUnauthorized is true', () => {
      mockHas.mockReturnValue(false)
      mockUseAuth.mockReturnValue({
        isSignedIn: true,
        orgId: 'org_123',
        has: mockHas,
      })

      render(
        <ProtectedContent requiredRole={ROLES.ADMIN} hideWhenUnauthorized>
          <div>Admin panel</div>
        </ProtectedContent>
      )

      const loadedContent = screen.getByTestId('clerk-loaded')
      expect(loadedContent.textContent).toBe('')
    })

    it('shows custom fallback when lacking role', () => {
      mockHas.mockReturnValue(false)
      mockUseAuth.mockReturnValue({
        isSignedIn: true,
        orgId: 'org_123',
        has: mockHas,
      })

      render(
        <ProtectedContent
          requiredRole={ROLES.ADMIN}
          fallback={<div>Admin only</div>}
        >
          <div>Admin panel</div>
        </ProtectedContent>
      )

      expect(screen.getByText('Admin only')).toBeInTheDocument()
    })
  })

  describe('authorized user', () => {
    it('renders children when fully authorized', () => {
      mockHas.mockReturnValue(true)
      mockUseAuth.mockReturnValue({
        isSignedIn: true,
        orgId: 'org_123',
        has: mockHas,
      })

      render(
        <ProtectedContent>
          <div>Protected content</div>
        </ProtectedContent>
      )

      expect(screen.getByText('Protected content')).toBeInTheDocument()
    })
  })
})
