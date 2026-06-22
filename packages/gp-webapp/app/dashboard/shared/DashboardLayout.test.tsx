import { describe, it, expect, vi, beforeEach } from 'vitest'
import { waitFor, screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import DashboardLayout from './DashboardLayout'

const { mockUseCampaign, mockIsImpersonating, mockIsDismissed, mockWeeksTill } =
  vi.hoisted(() => ({
    mockUseCampaign: vi.fn(),
    mockIsImpersonating: vi.fn(() => false),
    mockIsDismissed: vi.fn(() => false),
    mockWeeksTill: vi.fn(() => ({ weeks: -1 })),
  }))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => mockUseCampaign(),
}))
vi.mock('@shared/hooks/useIsImpersonating', () => ({
  useIsImpersonating: () => mockIsImpersonating(),
}))
vi.mock('../election-result/dismissal', () => ({
  isElectionResultDismissed: () => mockIsDismissed(),
}))
vi.mock('helpers/dateHelper', () => ({
  weeksTill: () => mockWeeksTill(),
}))

vi.mock('@shared/hooks/useUser', () => ({ useUser: () => [null] }))
vi.mock('@shared/organization-picker', () => ({ useOrganization: () => null }))
vi.mock('@shared/hooks/EcanvasserProvider', () => ({
  EcanvasserProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('./DashboardMenu', () => ({ default: () => null }))
vi.mock('./ProUpgradePrompt', () => ({ ProUpgradePrompt: () => null }))
vi.mock('@shared/user/ImpersonationBanner', () => ({ default: () => null }))
vi.mock('@styleguide/components/ui/icons', () => ({
  MenuIcon: () => null,
  XMarkIcon: () => null,
}))
vi.mock('@styleguide', () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => children,
  SidebarInset: ({ children }: { children: React.ReactNode }) => children,
  SidebarProvider: ({ children }: { children: React.ReactNode }) => children,
  useSidebar: () => ({ setOpenMobile: vi.fn(), openMobile: false }),
}))

const renderLayout = () =>
  render(
    <DashboardLayout>
      <div>dashboard content</div>
    </DashboardLayout>,
  )

describe('DashboardLayout election-result redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Active campaign whose general election has passed (weeks < 0) with no
    // recorded result — the condition that forces the election-result gate.
    mockUseCampaign.mockReturnValue([
      { details: { electionDate: '2020-01-01' } },
    ])
    mockIsImpersonating.mockReturnValue(false)
    mockIsDismissed.mockReturnValue(false)
    mockWeeksTill.mockReturnValue({ weeks: -1 })
  })

  it('redirects a normal user once the general election has passed', async () => {
    renderLayout()
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/dashboard/election-result'),
    )
  })

  it('still redirects a normal user even if a stale dismissal flag is set', async () => {
    mockIsDismissed.mockReturnValue(true)
    renderLayout()
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/dashboard/election-result'),
    )
    // The dismissal check must not be consulted for non-impersonating users;
    // the `isImpersonating &&` short-circuit guarantees a stale flag can never
    // suppress the redirect for a real candidate.
    expect(mockIsDismissed).not.toHaveBeenCalled()
  })

  it('does not redirect an impersonating admin who dismissed the gate', async () => {
    mockIsImpersonating.mockReturnValue(true)
    mockIsDismissed.mockReturnValue(true)
    renderLayout()
    await screen.findByText('dashboard content')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('redirects an impersonating admin who has not dismissed the gate', async () => {
    mockIsImpersonating.mockReturnValue(true)
    mockIsDismissed.mockReturnValue(false)
    renderLayout()
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/dashboard/election-result'),
    )
  })
})
