import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { Organization } from 'gpApi/api-endpoints'
import { User, UserRole } from 'helpers/types'

const mockUseUser = vi.fn()
const mockUseOrganization = vi.fn()
const mockUseOrganizations = vi.fn()
const mockSetOrganizationSlug = vi.fn()
const mockHandleLogOut = vi.fn()
const mockUseTeamAccountsFlag = vi.fn()

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
vi.mock('@shared/experiments/teamAccountsFlag', () => ({
  useTeamAccountsFlag: (...args: unknown[]) => mockUseTeamAccountsFlag(...args),
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

// A campaign the same person owns, distinct from the volunteer orgs above —
// exercises the destination-org-role branch of handleOrgSelect.
const orgOwned: Organization = {
  slug: 'org-3',
  name: 'Val Unteer for Mayor',
  positionName: null,
  position: null,
  district: null,
  electedOfficeId: null,
  campaignId: 3,
  status: 'active',
  role: 'owner',
  ownerName: 'Val Unteer',
}

const children = <div data-testid="volunteer-children">assignments</div>

describe('VolunteerSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUser.mockReturnValue([user])
    mockUseOrganization.mockReturnValue(orgOne)
    mockUseOrganizations.mockReturnValue([orgOne])
    mockUseTeamAccountsFlag.mockReturnValue({ ready: true, enabled: true })
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

  // The list isn't filtered to volunteer-role orgs (a volunteer can also own
  // another campaign), so the destination shell has to follow the org just
  // picked, not the one being left.
  describe('with a mixed-role fixture (one volunteer org, one owned org)', () => {
    it('navigates to /volunteer when the picked org is one the user volunteers for', async () => {
      mockUseOrganization.mockReturnValue(orgOwned)
      mockUseOrganizations.mockReturnValue([orgOne, orgOwned])
      const userEventInstance = userEvent.setup()
      render(<VolunteerSidebar>{children}</VolunteerSidebar>)

      await userEventInstance.click(
        screen.getByRole('button', { name: /switch campaign/i }),
      )
      await userEventInstance.click(
        screen.getByRole('radio', { name: /renee wells/i }),
      )

      expect(mockSetOrganizationSlug).toHaveBeenCalledWith('org-1')
      expect(router.push).toHaveBeenCalledWith('/volunteer')
    })

    it('navigates to /dashboard when the picked org is one the user owns', async () => {
      mockUseOrganization.mockReturnValue(orgOne)
      mockUseOrganizations.mockReturnValue([orgOne, orgOwned])
      const userEventInstance = userEvent.setup()
      render(<VolunteerSidebar>{children}</VolunteerSidebar>)

      await userEventInstance.click(
        screen.getByRole('button', { name: /switch campaign/i }),
      )
      await userEventInstance.click(
        screen.getByRole('radio', { name: /val unteer/i }),
      )

      expect(mockSetOrganizationSlug).toHaveBeenCalledWith('org-3')
      expect(router.push).toHaveBeenCalledWith('/dashboard')
    })
  })
})
