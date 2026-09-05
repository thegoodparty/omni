import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { User, UserRole } from 'helpers/types'

const mockUseUser = vi.fn()
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => mockUseUser(),
}))
vi.mock('@shared/organization-picker', () => ({
  OrganizationPicker: () => <div data-testid="org-picker" />,
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
})
