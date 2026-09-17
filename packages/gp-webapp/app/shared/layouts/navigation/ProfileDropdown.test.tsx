import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { User, UserRole } from 'helpers/types'
import ProfileDropdown from './ProfileDropdown'

const { mockUseOrganizationRole, mockUseHandleLogOut } = vi.hoisted(() => ({
  mockUseOrganizationRole: vi.fn(),
  mockUseHandleLogOut: vi.fn(() => vi.fn()),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganizationRole: () => mockUseOrganizationRole(),
}))
vi.mock('@shared/user/handleLogOut', () => ({
  useHandleLogOut: () => mockUseHandleLogOut(),
}))

const user: User = {
  id: 1,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  hasPassword: true,
  roles: [UserRole.candidate],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseOrganizationRole.mockReturnValue(undefined)
})

describe('ProfileDropdown — Account Settings visibility x organization role', () => {
  it('shows Account Settings for an owner', () => {
    mockUseOrganizationRole.mockReturnValue('owner')
    render(<ProfileDropdown open toggleCallback={vi.fn()} user={user} />)
    expect(screen.getByText('Account Settings')).toBeInTheDocument()
  })

  it('shows Account Settings when no role has resolved (solo user)', () => {
    mockUseOrganizationRole.mockReturnValue(undefined)
    render(<ProfileDropdown open toggleCallback={vi.fn()} user={user} />)
    expect(screen.getByText('Account Settings')).toBeInTheDocument()
  })

  it('hides Account Settings for a campaignAdmin (manager)', () => {
    mockUseOrganizationRole.mockReturnValue('campaignAdmin')
    render(<ProfileDropdown open toggleCallback={vi.fn()} user={user} />)
    expect(screen.queryByText('Account Settings')).not.toBeInTheDocument()
  })

  it('still shows Profile for a campaignAdmin — only account settings is gated', () => {
    mockUseOrganizationRole.mockReturnValue('campaignAdmin')
    render(<ProfileDropdown open toggleCallback={vi.fn()} user={user} />)
    expect(screen.getByText('Profile')).toBeInTheDocument()
  })

  it('hides Account Settings for a volunteer', () => {
    mockUseOrganizationRole.mockReturnValue('volunteer')
    render(<ProfileDropdown open toggleCallback={vi.fn()} user={user} />)
    expect(screen.queryByText('Account Settings')).not.toBeInTheDocument()
  })

  it('still shows Profile for a volunteer — only account settings is gated', () => {
    mockUseOrganizationRole.mockReturnValue('volunteer')
    render(<ProfileDropdown open toggleCallback={vi.fn()} user={user} />)
    expect(screen.getByText('Profile')).toBeInTheDocument()
  })
})
