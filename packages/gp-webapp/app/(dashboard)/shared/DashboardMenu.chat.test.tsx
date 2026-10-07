import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { SidebarProvider } from '@styleguide'
import DashboardMenu from './DashboardMenu'

// The sidebar's Chat pill: Win's way into the chat on every page, and the
// other end of Home's chat box morph.

const { mockUseOrganization, mockChat, mockMorphOut, mockMarkArriving } =
  vi.hoisted(() => ({
    mockUseOrganization: vi.fn(),
    mockChat: vi.fn(),
    mockMorphOut: vi.fn(),
    mockMarkArriving: vi.fn(),
  }))

vi.mock('@shared/hooks/useElectedOffice', () => ({
  useElectedOffice: () => ({ data: null, isLoading: false }),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockUseOrganization(),
  useOrganizationRole: () => undefined,
  OrganizationPicker: () => null,
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [null, vi.fn(), false],
}))
vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({ user: null, isLoaded: true }),
}))
vi.mock('@styleguide/hooks/use-mobile', () => ({ useIsMobile: () => false }))
vi.mock('./membership/MembershipBanner', () => ({
  MembershipBanner: () => null,
}))
vi.mock('../campaign-manager/CampaignManagerChatProvider', () => ({
  useCampaignManagerChat: () => mockChat(),
}))
vi.mock('./chatMorph', () => ({
  morphComposerIntoPill: () => mockMorphOut(),
  markArrivingAtHome: () => mockMarkArriving(),
}))

const renderMenu = (pathname: string) =>
  render(
    <SidebarProvider>
      <DashboardMenu pathname={pathname} />
    </SidebarProvider>,
  )

const chatPill = () => screen.queryByRole('button', { name: /^chat$/i })

beforeEach(() => {
  vi.clearAllMocks()
  mockUseOrganization.mockReturnValue({ slug: 'campaign-1' })
  mockChat.mockReturnValue({ openManager: vi.fn() })
})

describe('DashboardMenu Chat pill', () => {
  it('opens the chat from the sidebar on Win', async () => {
    const openManager = vi.fn()
    mockChat.mockReturnValue({ openManager })
    renderMenu('/outreach')

    await userEvent.click(chatPill()!)
    expect(openManager).toHaveBeenCalledTimes(1)
  })

  it('is not there without the chat (Serve)', () => {
    mockUseOrganization.mockReturnValue({
      slug: 'office-1',
      electedOfficeId: 'eo_1',
    })
    mockChat.mockReturnValue(null)
    renderMenu('/chief-of-staff')

    expect(chatPill()).not.toBeInTheDocument()
  })

  it('keeps the pill hidden on Home, where the chat box is the chat', () => {
    renderMenu('/home')

    expect(chatPill()).not.toBeInTheDocument()
  })

  it('shrinks Home’s chat box into the pill when leaving Home', async () => {
    renderMenu('/home')

    await userEvent.click(screen.getByRole('link', { name: 'Game Plan' }))
    expect(mockMorphOut).toHaveBeenCalledTimes(1)
    expect(mockMarkArriving).not.toHaveBeenCalled()
  })

  it('grows it back out when returning to Home', async () => {
    renderMenu('/outreach')

    await userEvent.click(screen.getByRole('link', { name: 'Home' }))
    expect(mockMarkArriving).toHaveBeenCalledTimes(1)
    expect(mockMorphOut).not.toHaveBeenCalled()
  })
})
