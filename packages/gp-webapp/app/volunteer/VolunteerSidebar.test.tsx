import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { api } from 'helpers/test-utils/api-mocking'
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
  ORGANIZATIONS_QUERY_KEY: ['organizations'],
  useOrganization: () => mockUseOrganization(),
  useOrganizations: () => mockUseOrganizations(),
  useSetOrganizationSlug: () => mockSetOrganizationSlug,
  OrganizationScope: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@shared/user/handleLogOut', () => ({
  useHandleLogOut: () => mockHandleLogOut,
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    displaySnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
  }),
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

  // ENG-11739: a long volunteer name painted past the rail's right edge and
  // over the content column instead of truncating. jsdom has no layout, so this
  // asserts the constraint that makes truncation possible rather than a
  // measured width: globals.css gives every `<li>` under a `data-slot` ancestor
  // `display: flex`, which makes this row a flex item whose default
  // `min-width: auto` floors it at the nowrap name's min-content width. The row
  // has to pin its own width so the `min-w-0 flex-1` column below it can shrink.
  it('pins the user block row to the rail width so the name can truncate', () => {
    render(<VolunteerSidebar>{children}</VolunteerSidebar>)

    const nameSpan = screen.getByText('Val Unteer')
    const textColumn = nameSpan.parentElement
    const row = textColumn?.parentElement

    expect(row).toHaveClass('flex', 'w-full', 'min-w-0')
    expect(nameSpan).toHaveClass('truncate')
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

    // ENG-11739, second instance: the switcher's rows are grid items of the
    // `grid gap-1` RadioGroup, so the same automatic minimum size floors each
    // row at its longest nowrap line and the campaign names paint past the rail.
    it('lets a switch-campaign row shrink so its labels truncate', async () => {
      const userEventInstance = userEvent.setup()
      render(<VolunteerSidebar>{children}</VolunteerSidebar>)

      await userEventInstance.click(
        screen.getByRole('button', { name: /switch campaign/i }),
      )

      const row = screen.getByText('Renee Wells').closest('label')

      expect(row).toHaveClass('flex', 'min-w-0')
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

  // ENG-11137: self-removal. The dialog confirms before anything is sent;
  // the destination after leaving follows the same rule as the campaign
  // switcher (next org's role decides the shell), or the post-auth resolver
  // at `/` when no campaign remains.
  describe('Leave campaign', () => {
    const confirmLeave = async (
      userEventInstance: ReturnType<typeof userEvent.setup>,
    ) => {
      await userEventInstance.click(
        screen.getByRole('button', { name: /leave campaign/i }),
      )
      const dialog = await screen.findByRole('alertdialog')
      await userEventInstance.click(
        within(dialog).getByRole('button', { name: /leave campaign/i }),
      )
    }

    it('opens a confirmation dialog and sends nothing until confirmed', async () => {
      const leaveRequest = vi.fn()
      api.mock('DELETE /v1/organizations/team/members/me', () => {
        leaveRequest()
        return { status: 200, data: undefined }
      })
      const userEventInstance = userEvent.setup()
      render(<VolunteerSidebar>{children}</VolunteerSidebar>)

      await userEventInstance.click(
        screen.getByRole('button', { name: /leave campaign/i }),
      )

      const dialog = await screen.findByRole('alertdialog')
      expect(
        within(dialog).getByText('Leave this campaign?'),
      ).toBeInTheDocument()
      expect(leaveRequest).not.toHaveBeenCalled()

      await userEventInstance.click(
        within(dialog).getByRole('button', { name: /cancel/i }),
      )
      expect(leaveRequest).not.toHaveBeenCalled()
      expect(router.push).not.toHaveBeenCalled()
    })

    it('leaves the only campaign and hands routing to the post-auth resolver', async () => {
      const leaveRequest = vi.fn()
      api.mock('DELETE /v1/organizations/team/members/me', () => {
        leaveRequest()
        return { status: 200, data: undefined }
      })
      const userEventInstance = userEvent.setup()
      render(<VolunteerSidebar>{children}</VolunteerSidebar>)

      await confirmLeave(userEventInstance)

      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/'))
      expect(leaveRequest).toHaveBeenCalledTimes(1)
      expect(mockSetOrganizationSlug).not.toHaveBeenCalled()
    })

    it('switches to the next campaign after leaving one of several', async () => {
      mockUseOrganizations.mockReturnValue([orgOne, orgTwo])
      api.mock('DELETE /v1/organizations/team/members/me', {
        status: 200,
        data: undefined,
      })
      const userEventInstance = userEvent.setup()
      render(<VolunteerSidebar>{children}</VolunteerSidebar>)

      await confirmLeave(userEventInstance)

      await waitFor(() =>
        expect(mockSetOrganizationSlug).toHaveBeenCalledWith('org-2'),
      )
      expect(router.push).toHaveBeenCalledWith('/volunteer')
    })

    it('routes to /dashboard when the remaining campaign is one the user owns', async () => {
      mockUseOrganizations.mockReturnValue([orgOne, orgOwned])
      api.mock('DELETE /v1/organizations/team/members/me', {
        status: 200,
        data: undefined,
      })
      const userEventInstance = userEvent.setup()
      render(<VolunteerSidebar>{children}</VolunteerSidebar>)

      await confirmLeave(userEventInstance)

      await waitFor(() =>
        expect(mockSetOrganizationSlug).toHaveBeenCalledWith('org-3'),
      )
      expect(router.push).toHaveBeenCalledWith('/dashboard')
    })

    it('stays put when the leave request fails', async () => {
      const leaveRequest = vi.fn()
      api.mock('DELETE /v1/organizations/team/members/me', () => {
        leaveRequest()
        return { status: 500, data: {} }
      })
      const userEventInstance = userEvent.setup()
      render(<VolunteerSidebar>{children}</VolunteerSidebar>)

      await confirmLeave(userEventInstance)

      await waitFor(() => expect(leaveRequest).toHaveBeenCalled())
      expect(router.push).not.toHaveBeenCalled()
      expect(mockSetOrganizationSlug).not.toHaveBeenCalled()
    })
  })
})
