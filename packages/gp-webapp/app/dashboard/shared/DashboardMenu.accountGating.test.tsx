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
  mockUseIsMobile,
} = vi.hoisted(() => ({
  mockUseElectedOffice: vi.fn(),
  mockUseOrganization: vi.fn(),
  mockUseOrganizationRole: vi.fn(),
  mockUseTeamAccountsFlag: vi.fn(),
  mockUseAppUser: vi.fn(),
  mockUseClerkUser: vi.fn(),
  mockUseIsMobile: vi.fn(),
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
// SidebarProvider/useSidebar derive isMobile from this hook (window.innerWidth
// under the hood) — mock it directly, same pattern as
// organization-picker.test.tsx, rather than juggling window.innerWidth: it's
// the one seam that flips both the real SidebarProvider's internal state and
// DashboardMenu's own useSidebar() read together.
vi.mock('@styleguide/hooks/use-mobile', () => ({
  useIsMobile: () => mockUseIsMobile(),
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
  // Desktop by default — matches the jsdom-default (isMobile=false) baseline
  // every pre-existing test in this file already assumed.
  mockUseIsMobile.mockReturnValue(false)
})

describe('DashboardMenu — Team removed from the primary nav (ENG-11061)', () => {
  it('never renders a primary-nav Team item, flag on or off', () => {
    mockUseTeamAccountsFlag.mockReturnValue({ ready: true, enabled: true })
    renderMenu()
    // The account-menu Team item only exists inside the closed dropdown
    // below, so an unopened render proves the primary nav has none.
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
  })
})

describe('DashboardMenu — Team item in the account menu (ENG-11061)', () => {
  // The account-management links render inside the desktop footer's
  // DropdownMenuContent, which Radix only mounts once its trigger opens —
  // same reasoning as the Account Settings assertions below.
  const openAccountMenu = async () => {
    const user = userEvent.setup()
    await user.click(screen.getByText('Manage account'))
  }

  it('is absent when the flag is off', async () => {
    mockUseTeamAccountsFlag.mockReturnValue({ ready: true, enabled: false })
    renderMenu()
    await openAccountMenu()
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
  })

  it('shows Team in the account menu when the flag is on', async () => {
    mockUseTeamAccountsFlag.mockReturnValue({ ready: true, enabled: true })
    renderMenu()
    await openAccountMenu()
    expect(screen.getByText('Team')).toBeInTheDocument()
  })

  it('hides Team for an elected office, even when the flag is on', async () => {
    mockUseTeamAccountsFlag.mockReturnValue({ ready: true, enabled: true })
    mockUseElectedOffice.mockReturnValue({
      data: { id: 'eo-1' },
      isLoading: false,
    })
    mockUseOrganization.mockReturnValue({
      slug: 'eo-1',
      electedOfficeId: 'eo-1',
    })
    renderMenu()
    await openAccountMenu()
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
  })

  // Bugbot review (ENG-11061): useElectedOffice() is an async, per-org-slug
  // query. Right after the org picker switches the active org,
  // organization.electedOfficeId (useOrganization) flips synchronously, but
  // this query is still resolving for the new slug — data can still read
  // undefined (or, on a slow refetch, hold the previous org's cached
  // result). Without the synchronous organization.electedOfficeId check,
  // Team would flash for a Serve org during exactly this window.
  it('hides Team for an elected office even while the async elected-office query is still pending', async () => {
    mockUseTeamAccountsFlag.mockReturnValue({ ready: true, enabled: true })
    mockUseElectedOffice.mockReturnValue({ data: undefined, isLoading: true })
    mockUseOrganization.mockReturnValue({
      slug: 'eo-1',
      electedOfficeId: 'eo-1',
    })
    renderMenu()
    await openAccountMenu()
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
  })

  it('reads the flag without tracking exposure (nav is not the treatment surface)', () => {
    renderMenu()
    expect(mockUseTeamAccountsFlag).toHaveBeenCalledWith(false)
  })
})

describe('DashboardMenu — Team item in the mobile sidebar (ENG-11061)', () => {
  // Team's mobile placement is a second, independent render path
  // (DashboardMenu.tsx's `isMobile &&` block) — it renders the item directly
  // in the sidebar rather than behind the desktop dropdown, so no
  // openAccountMenu() step is needed here.
  beforeEach(() => {
    mockUseIsMobile.mockReturnValue(true)
  })

  it('is absent when the flag is off', () => {
    mockUseTeamAccountsFlag.mockReturnValue({ ready: true, enabled: false })
    renderMenu()
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
  })

  it('shows Team in the mobile sidebar when the flag is on', () => {
    mockUseTeamAccountsFlag.mockReturnValue({ ready: true, enabled: true })
    renderMenu()
    expect(screen.getByText('Team')).toBeInTheDocument()
  })

  it('hides Team for an elected office, even when the flag is on', () => {
    mockUseTeamAccountsFlag.mockReturnValue({ ready: true, enabled: true })
    mockUseElectedOffice.mockReturnValue({
      data: { id: 'eo-1' },
      isLoading: false,
    })
    mockUseOrganization.mockReturnValue({
      slug: 'eo-1',
      electedOfficeId: 'eo-1',
    })
    renderMenu()
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
  })

  it('hides Team for an elected office even while the async elected-office query is still pending', () => {
    mockUseTeamAccountsFlag.mockReturnValue({ ready: true, enabled: true })
    mockUseElectedOffice.mockReturnValue({ data: undefined, isLoading: true })
    mockUseOrganization.mockReturnValue({
      slug: 'eo-1',
      electedOfficeId: 'eo-1',
    })
    renderMenu()
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
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
