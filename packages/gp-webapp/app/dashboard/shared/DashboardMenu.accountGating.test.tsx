import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { SidebarProvider } from '@styleguide'
import DashboardMenu from './DashboardMenu'

// Renders the real DashboardMenu / NewNavMenu (unlike DashboardLayout.test.tsx,
// which mocks DashboardMenu out entirely) to exercise the two ENG-10829
// gating decisions together: the win-team-accounts flag (nav item) and the
// viewer's organization role (account-settings visibility). useCampaign and
// useEcanvasser are left un-mocked — both read from a context with a safe
// default ([null, ...]) when no provider wraps the tree, which is exactly the
// state this menu renders in for these assertions.

const {
  mockUseElectedOffice,
  mockUseOrganization,
  mockUseOrganizationRole,
  mockUseTeamAccountsFlag,
  mockUseAppUser,
  mockUseClerkUser,
} = vi.hoisted(() => ({
  mockUseElectedOffice: vi.fn(),
  mockUseOrganization: vi.fn(),
  mockUseOrganizationRole: vi.fn(),
  mockUseTeamAccountsFlag: vi.fn(),
  mockUseAppUser: vi.fn(),
  mockUseClerkUser: vi.fn(),
}))

vi.mock('@shared/hooks/useElectedOffice', () => ({
  useElectedOffice: () => mockUseElectedOffice(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockUseOrganization(),
  useOrganizationRole: () => mockUseOrganizationRole(),
  OrganizationPicker: () => null,
}))
vi.mock('@shared/experiments/teamAccountsFlag', () => ({
  useTeamAccountsFlag: (...args: unknown[]) => mockUseTeamAccountsFlag(...args),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => mockUseAppUser(),
}))
vi.mock('@clerk/nextjs', () => ({
  useUser: () => mockUseClerkUser(),
}))

const renderMenu = () =>
  render(
    <SidebarProvider>
      <DashboardMenu pathname="/dashboard" />
    </SidebarProvider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockUseElectedOffice.mockReturnValue({ data: null, isLoading: false })
  mockUseOrganization.mockReturnValue({ slug: 'campaign-1' })
  mockUseOrganizationRole.mockReturnValue(undefined)
  mockUseTeamAccountsFlag.mockReturnValue({ ready: true, enabled: false })
  mockUseAppUser.mockReturnValue([null, vi.fn(), false])
  mockUseClerkUser.mockReturnValue({ user: null, isLoaded: true })
})

describe('DashboardMenu — Team nav item x win-team-accounts flag', () => {
  it('renders no Team nav item when the flag is off', () => {
    mockUseTeamAccountsFlag.mockReturnValue({ ready: true, enabled: false })
    renderMenu()
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
  })

  it('renders the Team nav item when the flag is on', () => {
    mockUseTeamAccountsFlag.mockReturnValue({ ready: true, enabled: true })
    renderMenu()
    expect(screen.getByText('Team')).toBeInTheDocument()
  })

  it('reads the flag without tracking exposure (nav is not the treatment surface)', () => {
    renderMenu()
    expect(mockUseTeamAccountsFlag).toHaveBeenCalledWith(false)
  })
})

describe('DashboardMenu — Account Settings visibility x organization role', () => {
  // The account-management links render inside the desktop footer's
  // DropdownMenuContent, which Radix only mounts once its trigger opens —
  // opening it is what makes "not present" a real assertion rather than one
  // that would pass regardless of the gating.
  const openAccountMenu = async () => {
    const user = userEvent.setup()
    await user.click(screen.getByText('Manage account'))
  }

  it('shows Account Settings for an owner (today’s menu, unchanged)', async () => {
    mockUseOrganizationRole.mockReturnValue('owner')
    renderMenu()
    await openAccountMenu()
    expect(screen.getAllByText('Account Settings').length).toBeGreaterThan(0)
  })

  it('shows Account Settings when no role has resolved (solo user, undefined role)', async () => {
    mockUseOrganizationRole.mockReturnValue(undefined)
    renderMenu()
    await openAccountMenu()
    expect(screen.getAllByText('Account Settings').length).toBeGreaterThan(0)
  })

  it('hides Account Settings for a campaignAdmin (manager)', async () => {
    mockUseOrganizationRole.mockReturnValue('campaignAdmin')
    renderMenu()
    await openAccountMenu()
    expect(screen.queryByText('Account Settings')).not.toBeInTheDocument()
  })

  it('still shows Profile for a campaignAdmin — only account settings is gated', async () => {
    mockUseOrganizationRole.mockReturnValue('campaignAdmin')
    renderMenu()
    await openAccountMenu()
    expect(screen.getAllByText('Profile').length).toBeGreaterThan(0)
  })
})
