import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { SidebarProvider } from '@styleguide'
import DashboardMenu from './DashboardMenu'

// Renders the real DashboardMenu to check which tab reads as the current page.

const {
  mockUseElectedOffice,
  mockUseOrganization,
  mockUseOrganizationRole,
  mockUseAppUser,
  mockUseClerkUser,
  mockUseIsMobile,
} = vi.hoisted(() => ({
  mockUseElectedOffice: vi.fn(),
  mockUseOrganization: vi.fn(),
  mockUseOrganizationRole: vi.fn(),
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
vi.mock('./membership/MembershipBanner', () => ({
  MembershipBanner: () => null,
}))

const renderMenu = (pathname: string) =>
  render(
    <SidebarProvider>
      <DashboardMenu pathname={pathname} />
    </SidebarProvider>,
  )

const currentLinks = () =>
  screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  mockUseElectedOffice.mockReturnValue({ data: null, isLoading: false })
  mockUseOrganization.mockReturnValue({ slug: 'campaign-1' })
  mockUseOrganizationRole.mockReturnValue(undefined)
  mockUseAppUser.mockReturnValue([null, vi.fn(), false])
  mockUseClerkUser.mockReturnValue({ user: null, isLoaded: true })
  mockUseIsMobile.mockReturnValue(false)
})

describe('DashboardMenu current page (Win)', () => {
  it('marks only the current tab as the current page', () => {
    renderMenu('/campaign-plan')
    expect(currentLinks()).toEqual(['Campaign Plan'])
  })

  it('keeps a tab current on its sub-pages', () => {
    renderMenu('/outreach/phone-banking/5')
    expect(currentLinks()).toEqual(['Voter Outreach'])
  })

  it('does not mark a tab whose path is only a prefix of the word', () => {
    renderMenu('/outreach-results')
    expect(currentLinks()).toEqual([])
  })
})

describe('DashboardMenu current page (Serve)', () => {
  it('matches exactly, as before', () => {
    mockUseElectedOffice.mockReturnValue({ data: { id: 1 }, isLoading: false })
    mockUseOrganization.mockReturnValue({ slug: 'eo-1', electedOfficeId: 1 })
    renderMenu('/chief-of-staff/archive')
    expect(currentLinks()).toEqual([])
  })
})
