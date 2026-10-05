import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Campaign } from 'helpers/types'
import DoorKnockingPageGate from './DoorKnockingPageGate'

const electedOfficeState: { data: object | null; isPending: boolean } = {
  data: null,
  isPending: false,
}

const { mockProGatingFlag } = vi.hoisted(() => ({
  mockProGatingFlag: vi.fn(() => ({ ready: true, enabled: false })),
}))
vi.mock('app/shared/experiments/outreachProGatingV2Flag', () => ({
  useOutreachProGatingV2Flag: () => mockProGatingFlag(),
}))
vi.mock('@shared/hooks/useElectedOffice', () => ({
  useElectedOffice: () => electedOfficeState,
}))
vi.mock('./NativeDoorKnockingPage', () => ({
  __esModule: true,
  default: ({
    preselectedListId,
    preselectedRecommendedVariant,
  }: {
    preselectedListId?: number
    preselectedRecommendedVariant?: string
  }) => (
    <div
      data-testid="native-door-knocking"
      data-preselected-list={String(preselectedListId)}
      data-preselected-variant={String(preselectedRecommendedVariant)}
    />
  ),
}))
vi.mock('app/(dashboard)/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const proCampaign = { isPro: true } as Campaign

const props = {
  pathname: '/door-knocking',
  campaign: proCampaign,
}

const setState = (
  electedOffice: object | null = null,
  isElectedOfficePending = false,
) => {
  electedOfficeState.data = electedOffice
  electedOfficeState.isPending = isElectedOfficePending
}

describe('DoorKnockingPageGate', () => {
  it('renders the native experience for a Pro campaign', () => {
    setState()
    render(<DoorKnockingPageGate {...props} />)
    expect(screen.getByTestId('native-door-knocking')).toBeInTheDocument()
  })

  // ENG-10888. The map is worse than useless without Pro: every pack, turf and
  // route read 400s, so it would draw and then fail on the first interaction.
  it('renders the upgrade view for a non-Pro campaign', () => {
    setState()
    render(<DoorKnockingPageGate {...props} campaign={{} as Campaign} />)
    expect(screen.queryByTestId('native-door-knocking')).toBeNull()
    expect(screen.getByText('Door knocking is a Pro feature')).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Upgrade to Pro' }),
    ).toHaveAttribute('href', '/pro-upgrade')
  })

  // Under outreach-pro-gating-v2 the map's reads are open to a free campaign
  // and the create flow gates Build route, so the page admits them.
  it('renders the native experience for a non-Pro campaign under the pro gating flag', () => {
    mockProGatingFlag.mockReturnValue({ ready: true, enabled: true })
    setState()
    render(<DoorKnockingPageGate {...props} campaign={{} as Campaign} />)
    expect(screen.getByTestId('native-door-knocking')).toBeVisible()
    mockProGatingFlag.mockReturnValue({ ready: true, enabled: false })
  })

  it('renders the upgrade view when there is no campaign at all', () => {
    setState()
    render(<DoorKnockingPageGate {...props} campaign={null} />)
    expect(screen.queryByTestId('native-door-knocking')).toBeNull()
    expect(screen.getByText('Door knocking is a Pro feature')).toBeVisible()
  })

  // hasElectedOfficeAccess in gp-api grants access ahead of isPro, so an
  // elected-office org must not be sent to an upgrade prompt the API would
  // never have refused.
  it('renders the native experience for an elected office without Pro', () => {
    setState({ id: 1 })
    render(<DoorKnockingPageGate {...props} campaign={{} as Campaign} />)
    expect(screen.getByTestId('native-door-knocking')).toBeInTheDocument()
  })

  // An in-flight elected-office query is not a refusal. A Serve org's access
  // comes from that query and its campaign is never isPro, so answering early
  // would show the upgrade card to the org most entitled to the feature on
  // every cold load or bookmarked URL.
  it('does not show the upgrade view while the elected-office query is in flight', () => {
    setState(null, true)
    render(<DoorKnockingPageGate {...props} campaign={{} as Campaign} />)
    expect(screen.queryByText('Door knocking is a Pro feature')).toBeNull()
    expect(screen.queryByTestId('native-door-knocking')).toBeNull()
  })

  // The wait is only owed to a campaign whose access could still turn out to
  // come from elected office; a Pro campaign is already entitled, so it must
  // not be held behind an unrelated query.
  it('renders the native experience for a Pro campaign without waiting on that query', () => {
    setState(null, true)
    render(<DoorKnockingPageGate {...props} />)
    expect(screen.getByTestId('native-door-knocking')).toBeInTheDocument()
  })

  // The `?listId=` the outreach hub's door-knocking tile carries here — the
  // gate must not swallow it on the way to the create flow.
  it('hands the carried list to the native experience', () => {
    setState()
    render(<DoorKnockingPageGate {...props} preselectedListId={42} />)
    expect(screen.getByTestId('native-door-knocking')).toHaveAttribute(
      'data-preselected-list',
      '42',
    )
  })

  it('hands a carried recommended variant to the native experience', () => {
    setState()
    render(
      <DoorKnockingPageGate
        {...props}
        preselectedRecommendedVariant="persuadeAffinity"
      />,
    )
    expect(screen.getByTestId('native-door-knocking')).toHaveAttribute(
      'data-preselected-variant',
      'persuadeAffinity',
    )
  })

  it('renders the native experience with no list carried in', () => {
    setState()
    render(<DoorKnockingPageGate {...props} />)
    expect(screen.getByTestId('native-door-knocking')).toHaveAttribute(
      'data-preselected-list',
      'undefined',
    )
  })
})
