import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ProtectedContent } from './ProtectedContent'
import { PERMISSIONS, ROLES } from '@/lib/permissions'

// Create a mock function that we can control per test
const mockHas = vi.fn()
const mockUseAuth = vi.fn()

// Mock Clerk
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => mockUseAuth(),
  ClerkLoading: () => null,
  ClerkLoaded: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('ProtectedContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHas.mockReset()
    mockUseAuth.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  describe('authentication states', () => {
    it('shows sign-in message when user is not authenticated', () => {
      mockUseAuth.mockReturnValue({
        isSignedIn: false,
        orgId: null,
        has: mockHas,
      })

      render(
        <ProtectedContent>
          <div>Secret content</div>
        </ProtectedContent>
      )

      expect(
        screen.getByText('You must be signed in to view this content.')
      ).toBeInTheDocument()
    })

    it('shows organization message when signed in but no org selected', () => {
      mockUseAuth.mockReturnValue({
        isSignedIn: true,
        orgId: null,
        has: mockHas,
      })

      render(
        <ProtectedContent>
          <div>Secret content</div>
        </ProtectedContent>
      )

      expect(
        screen.getByText('Please select an organization to continue.')
      ).toBeInTheDocument()
    })

    it('hides content completely when hideWhenUnauthorized is true', () => {
      mockUseAuth.mockReturnValue({
        isSignedIn: false,
        orgId: null,
        has: mockHas,
      })

      const { container } = render(
        <ProtectedContent hideWhenUnauthorized>
          <div>Secret content</div>
        </ProtectedContent>
      )

      expect(screen.queryByText('Secret content')).not.toBeInTheDocument()
      expect(
        screen.queryByText('You must be signed in to view this content.')
      ).not.toBeInTheDocument()
      expect(container.textContent).toBe('')
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
    })

    it('shows permission error when user lacks required permission', () => {
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
    })

    it('shows role error when user lacks required role', () => {
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
  })

  describe('custom fallback', () => {
    it('renders custom fallback instead of default message', () => {
      mockUseAuth.mockReturnValue({
        isSignedIn: false,
        orgId: null,
        has: mockHas,
      })

      render(
        <ProtectedContent fallback={<div>Custom fallback message</div>}>
          <div>Protected</div>
        </ProtectedContent>
      )

      expect(screen.getByText('Custom fallback message')).toBeInTheDocument()
    })
  })
})
