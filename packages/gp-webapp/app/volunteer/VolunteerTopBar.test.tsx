import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { User, UserRole } from 'helpers/types'

const mockUseUser = vi.fn()
const mockUseOrganization = vi.fn()
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => mockUseUser(),
}))
vi.mock('@shared/organization-picker', () => ({
  OrganizationPicker: () => <div data-testid="org-picker" />,
  useOrganization: () => mockUseOrganization(),
}))
vi.mock('@shared/layouts/navigation/ProfileDropdown', () => ({
  default: () => <div data-testid="profile-dropdown" />,
}))

import VolunteerTopBar from './VolunteerTopBar'

const user: User = {
  id: 1,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  firstName: 'Val',
  lastName: 'Unteer',
  email: 'val@example.com',
  hasPassword: true,
  roles: [UserRole.candidate],
}

describe('VolunteerTopBar', () => {
  beforeEach(() => {
    mockUseOrganization.mockReturnValue({
      slug: 'org-1',
      name: 'Renee Wells for City Council',
    })
  })

  it('renders the org picker and profile dropdown, and nothing dashboard-nav-shaped', () => {
    mockUseUser.mockReturnValue([user])

    render(<VolunteerTopBar />)

    expect(screen.getByTestId('org-picker')).toBeInTheDocument()
    expect(screen.getByTestId('profile-dropdown')).toBeInTheDocument()
    // No dashboard left-rail nav item text should ever reach this shell —
    // it renders only the two mocked components above plus the logo link.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('omits the profile dropdown while the user has not resolved yet', () => {
    mockUseUser.mockReturnValue([null])

    render(<VolunteerTopBar />)

    expect(screen.getByTestId('org-picker')).toBeInTheDocument()
    expect(screen.queryByTestId('profile-dropdown')).not.toBeInTheDocument()
  })

  it('renders the Volunteer badge', () => {
    mockUseUser.mockReturnValue([user])

    render(<VolunteerTopBar />)

    expect(screen.getByText('Volunteer')).toBeInTheDocument()
  })

  it('renders the campaign banner with the organization name once resolved', () => {
    mockUseUser.mockReturnValue([user])

    render(<VolunteerTopBar />)

    expect(screen.getByText('Renee Wells for City Council')).toBeInTheDocument()
  })

  it('renders no banner while the organization has not resolved yet', () => {
    mockUseUser.mockReturnValue([user])
    mockUseOrganization.mockReturnValue(undefined)

    render(<VolunteerTopBar />)

    expect(
      screen.queryByText('Renee Wells for City Council'),
    ).not.toBeInTheDocument()
  })
})
