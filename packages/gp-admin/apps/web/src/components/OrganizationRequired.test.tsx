import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OrganizationRequired } from './OrganizationRequired'

// Mock Clerk
vi.mock('@clerk/nextjs', () => ({
  useAuth: vi.fn(),
  ClerkLoading: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="clerk-loading">{children}</div>
  ),
  ClerkLoaded: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="clerk-loaded">{children}</div>
  ),
}))

import { useAuth } from '@clerk/nextjs'

const mockUseAuth = vi.mocked(useAuth)

describe('OrganizationRequired', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows sign-in message when user is not signed in', () => {
    mockUseAuth.mockReturnValue({
      isSignedIn: false,
      orgId: null,
    } as ReturnType<typeof useAuth>)

    render(
      <OrganizationRequired>
        <div>Protected content</div>
      </OrganizationRequired>
    )

    expect(screen.getByText('Please sign in to continue.')).toBeVisible()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('shows organization selection message when signed in but no org selected', () => {
    mockUseAuth.mockReturnValue({
      isSignedIn: true,
      orgId: null,
    } as ReturnType<typeof useAuth>)

    render(
      <OrganizationRequired>
        <div>Protected content</div>
      </OrganizationRequired>
    )

    expect(
      screen.getByText(
        'Please select an organization from the header to continue.'
      )
    ).toBeVisible()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('renders children when signed in with an organization', () => {
    mockUseAuth.mockReturnValue({
      isSignedIn: true,
      orgId: 'org_123',
    } as ReturnType<typeof useAuth>)

    render(
      <OrganizationRequired>
        <div>Protected content</div>
      </OrganizationRequired>
    )

    expect(screen.getByText('Protected content')).toBeVisible()
  })
})
