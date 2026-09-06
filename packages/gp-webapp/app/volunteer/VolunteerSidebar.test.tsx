import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { Organization } from 'gpApi/api-endpoints'
import { User, UserRole } from 'helpers/types'

const mockUseUser = vi.fn()
const mockUseOrganization = vi.fn()
const mockUseOrganizations = vi.fn()
const mockSetOrganizationSlug = vi.fn()
const mockHandleLogOut = vi.fn()

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => mockUseUser(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockUseOrganization(),
  useOrganizations: () => mockUseOrganizations(),
  useSetOrganizationSlug: () => mockSetOrganizationSlug,
}))
vi.mock('@shared/user/handleLogOut', () => ({
  useHandleLogOut: () => mockHandleLogOut,
}))

import VolunteerSidebar from './VolunteerSidebar'

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

const orgOne: Organization = {
  slug: 'org-1',
  name: 'Renee Wells for City Council',
  positionName: null,
  position: null,
  district: null,
  electedOfficeId: null,
  campaignId: 1,
  status: 'active',
  role: 'volunteer',
  ownerName: 'Renee Wells',
}

const orgTwo: Organization = {
  slug: 'org-2',
  name: 'Marcus Ortega for State Senate',
  positionName: null,
  position: null,
  district: null,
  electedOfficeId: null,
  campaignId: 2,
  status: 'active',
  role: 'volunteer',
  ownerName: 'Marcus Ortega',
}

const children = <div data-testid="volunteer-children">assignments</div>

describe('VolunteerSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUser.mockReturnValue([user])
    mockUseOrganization.mockReturnValue(orgOne)
    mockUseOrganizations.mockReturnValue([orgOne])
  })

  it('renders the sidebar user block and a logout row, with the active campaign name and no org picker or profile dropdown', () => {
    render(<VolunteerSidebar>{children}</VolunteerSidebar>)

    expect(screen.getByText('Val Unteer')).toBeInTheDocument()
    expect(
      screen.getAllByText('Renee Wells for City Council').length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument()
    expect(screen.queryByTestId('org-picker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('profile-dropdown')).not.toBeInTheDocument()
    expect(screen.getByTestId('volunteer-children')).toBeInTheDocument()
  })

  it('logs out when the Logout row is clicked', async () => {
    const userEventInstance = userEvent.setup()
    render(<VolunteerSidebar>{children}</VolunteerSidebar>)

    await userEventInstance.click(
      screen.getByRole('button', { name: /logout/i }),
    )

    expect(mockHandleLogOut).toHaveBeenCalled()
  })

  it('renders a slim top bar with only the active campaign name', () => {
    render(<VolunteerSidebar>{children}</VolunteerSidebar>)

    const bar = screen.getByTestId('volunteer-campaign-bar')
    expect(
      within(bar).getByText('Renee Wells for City Council'),
    ).toBeInTheDocument()
  })

  it('omits the switch-campaign control for a volunteer with only one org', () => {
    render(<VolunteerSidebar>{children}</VolunteerSidebar>)

    expect(screen.queryByText('Switch campaign')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /switch campaign/i }),
    ).not.toBeInTheDocument()
  })

  describe('with more than one campaign', () => {
    beforeEach(() => {
      mockUseOrganizations.mockReturnValue([orgOne, orgTwo])
    })

    it("expands an in-sidebar switch-campaign list of the volunteer's campaigns", async () => {
      const userEventInstance = userEvent.setup()
      render(<VolunteerSidebar>{children}</VolunteerSidebar>)

      expect(screen.queryByText('Switch campaign')).not.toBeInTheDocument()

      await userEventInstance.click(
        screen.getByRole('button', { name: /switch campaign/i }),
      )

      expect(screen.getByText('Switch campaign')).toBeInTheDocument()
      expect(screen.getByText('Renee Wells')).toBeInTheDocument()
      expect(screen.getByText('Marcus Ortega')).toBeInTheDocument()
    })

    it('switches the selected campaign slug when a different radio option is chosen', async () => {
      const userEventInstance = userEvent.setup()
      render(<VolunteerSidebar>{children}</VolunteerSidebar>)

      await userEventInstance.click(
        screen.getByRole('button', { name: /switch campaign/i }),
      )
      await userEventInstance.click(
        screen.getByRole('radio', { name: /marcus ortega/i }),
      )

      expect(mockSetOrganizationSlug).toHaveBeenCalledWith('org-2')
    })
  })
})
