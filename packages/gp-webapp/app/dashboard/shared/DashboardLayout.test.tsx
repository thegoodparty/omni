import { describe, it, expect, vi, beforeEach } from 'vitest'
import { waitFor, screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import DashboardLayout from './DashboardLayout'
import DashboardNavHeaderAction from './DashboardNavHeaderAction'

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
  SparklesIcon: () => null,
  ClipboardListIcon: () => null,
  FlagIcon: () => null,
  SendIcon: () => null,
  UsersRoundIcon: () => null,
  SwordsIcon: () => null,
  ScrollTextIcon: () => null,
  LayoutDashboardIcon: () => null,
  BookOpenIcon: () => null,
  CircleUserRoundIcon: () => null,
}))
vi.mock('@styleguide', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
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

// The title bar's CTA slot, exercised through the real layout rather than a
// stand-in harness — the wiring under test (ref callback -> state -> context ->
// portal, plus the mounted-action count) lives in DashboardLayout itself.
describe('DashboardLayout nav header CTA', () => {
  const navHeader = { icon: 'book', label: 'Your story' } as const
  const bar = () =>
    document.querySelector('[data-slot="nav-header-action"]')?.parentElement

  it('reparents a mounted action into the bar and keeps the bar on mobile', async () => {
    render(
      <DashboardLayout navHeader={navHeader}>
        <div data-testid="page-body">
          <DashboardNavHeaderAction>
            <button>Save</button>
          </DashboardNavHeaderAction>
        </div>
      </DashboardLayout>,
    )

    await waitFor(() => {
      expect(
        document.querySelector('[data-slot="nav-header-action"]'),
      ).toContainElement(screen.getByRole('button', { name: 'Save' }))
    })
    expect(screen.getByTestId('page-body')).not.toContainElement(
      screen.getByRole('button', { name: 'Save' }),
    )
    // The CTA has nowhere else to go on mobile, so the bar stays visible there.
    await waitFor(() => expect(bar()).toHaveClass('flex'))
    expect(bar()).not.toHaveClass('hidden')
  })

  it('keeps the bar desktop-only when the page state mounts no action', async () => {
    // Pairs with the two cases either side of it: mobile visibility is derived
    // from a mounted action, never declared. A page-level flag couldn't express
    // this — it read true for every state of a route, so states with no CTA
    // (Know Your Opponent's processing screen, Public Profile pre-mint, the
    // story gate, a loading story) rendered an empty 56px bar on mobile.
    render(
      <DashboardLayout navHeader={navHeader}>
        <div data-testid="page-body">no CTA in this state</div>
      </DashboardLayout>,
    )

    await waitFor(() => expect(bar()).toBeTruthy())
    expect(bar()).toHaveClass('hidden')
    expect(bar()).toHaveClass('lg:flex')
  })

  it('drops the action back out of the bar when it unmounts', async () => {
    const { rerender } = render(
      <DashboardLayout navHeader={navHeader}>
        <DashboardNavHeaderAction>
          <button>Save</button>
        </DashboardNavHeaderAction>
      </DashboardLayout>,
    )
    await waitFor(() => expect(bar()).toHaveClass('flex'))

    rerender(
      <DashboardLayout navHeader={navHeader}>
        <div>state with no CTA</div>
      </DashboardLayout>,
    )

    await waitFor(() => expect(bar()).toHaveClass('hidden'))
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument()
  })
})
