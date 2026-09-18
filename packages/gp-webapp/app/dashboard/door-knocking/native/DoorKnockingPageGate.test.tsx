import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Campaign } from 'helpers/types'
import DoorKnockingPageGate from './DoorKnockingPageGate'

const flagState = { ready: true, enabled: false }
// Milestone 2's in-flow gate. Off by default, so every case below keeps
// asserting the page-level Pro lock this feature shipped with.
const proGatingState = { ready: true, enabled: false }
const electedOfficeState: { data: object | null; isPending: boolean } = {
  data: null,
  isPending: false,
}

vi.mock('app/shared/experiments/nativeDoorKnockingFlag', () => ({
  useNativeDoorKnockingFlag: () => flagState,
}))
vi.mock('app/shared/experiments/outreachProGatingV2Flag', () => ({
  useOutreachProGatingV2Flag: () => proGatingState,
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
vi.mock('../components/DoorKnockingPage', () => ({
  __esModule: true,
  default: () => <div data-testid="ecanvasser-dashboard" />,
}))
vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const proCampaign = { isPro: true } as Campaign

const props = {
  pathname: '/dashboard/door-knocking',
  campaign: proCampaign,
}

const setState = (
  flag: { ready: boolean; enabled: boolean },
  electedOffice: object | null = null,
  isElectedOfficePending = false,
) => {
  flagState.ready = flag.ready
  flagState.enabled = flag.enabled
  electedOfficeState.data = electedOffice
  electedOfficeState.isPending = isElectedOfficePending
  proGatingState.ready = true
  proGatingState.enabled = false
}

describe('DoorKnockingPageGate', () => {
  it('renders the eCanvasser dashboard when the flag is off', () => {
    setState({ ready: true, enabled: false })
    render(<DoorKnockingPageGate {...props} />)
    expect(screen.getByTestId('ecanvasser-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('native-door-knocking')).toBeNull()
  })

  it('renders the eCanvasser dashboard while the flag is unsettled', () => {
    setState({ ready: false, enabled: true })
    render(<DoorKnockingPageGate {...props} />)
    expect(screen.getByTestId('ecanvasser-dashboard')).toBeInTheDocument()
  })

  it('renders the native experience for a Pro campaign on the flag', () => {
    setState({ ready: true, enabled: true })
    render(<DoorKnockingPageGate {...props} />)
    expect(screen.getByTestId('native-door-knocking')).toBeInTheDocument()
    expect(screen.queryByTestId('ecanvasser-dashboard')).toBeNull()
  })

  // ENG-10888. The map is worse than useless without Pro: every pack, turf and
  // route read 400s, so it would draw and then fail on the first interaction.
  it('renders the upgrade view for a non-Pro campaign on the flag', () => {
    setState({ ready: true, enabled: true })
    render(<DoorKnockingPageGate {...props} campaign={{} as Campaign} />)
    expect(screen.queryByTestId('native-door-knocking')).toBeNull()
    expect(screen.getByText('Door knocking is a Pro feature')).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Upgrade to Pro' }),
    ).toHaveAttribute('href', '/dashboard/pro-upgrade')
  })

  it('renders the upgrade view when there is no campaign at all', () => {
    setState({ ready: true, enabled: true })
    render(<DoorKnockingPageGate {...props} campaign={null} />)
    expect(screen.queryByTestId('native-door-knocking')).toBeNull()
    expect(screen.getByText('Door knocking is a Pro feature')).toBeVisible()
  })

  // hasElectedOfficeAccess in gp-api grants access ahead of isPro, so an
  // elected-office org must not be sent to an upgrade prompt the API would
  // never have refused.
  it('renders the native experience for an elected office without Pro', () => {
    setState({ ready: true, enabled: true }, { id: 1 })
    render(<DoorKnockingPageGate {...props} campaign={{} as Campaign} />)
    expect(screen.getByTestId('native-door-knocking')).toBeInTheDocument()
  })

  // An in-flight elected-office query is not a refusal. A Serve org's access
  // comes from that query and its campaign is never isPro, so answering early
  // would show the upgrade card to the org most entitled to the feature on
  // every cold load or bookmarked URL.
  it('does not show the upgrade view while the elected-office query is in flight', () => {
    setState({ ready: true, enabled: true }, null, true)
    render(<DoorKnockingPageGate {...props} campaign={{} as Campaign} />)
    expect(screen.queryByText('Door knocking is a Pro feature')).toBeNull()
    expect(screen.queryByTestId('native-door-knocking')).toBeNull()
  })

  // The wait is only owed to a campaign whose access could still turn out to
  // come from elected office; a Pro campaign is already entitled, so it must
  // not be held behind an unrelated query.
  it('renders the native experience for a Pro campaign without waiting on that query', () => {
    setState({ ready: true, enabled: true }, null, true)
    render(<DoorKnockingPageGate {...props} />)
    expect(screen.getByTestId('native-door-knocking')).toBeInTheDocument()
  })

  // Control is entitlement-free: the legacy eCanvasser dashboard was never
  // Pro-gated and this change must not gate it.
  it('renders the eCanvasser dashboard for a non-Pro campaign off the flag', () => {
    setState({ ready: true, enabled: false })
    render(<DoorKnockingPageGate {...props} campaign={{} as Campaign} />)
    expect(screen.getByTestId('ecanvasser-dashboard')).toBeInTheDocument()
  })

  // The `?listId=` the outreach hub's door-knocking tile carries here. Only
  // the native arm has a create flow to open on it, and the gate must not
  // swallow it on the way.
  it('hands the carried list to the native experience', () => {
    setState({ ready: true, enabled: true })
    render(<DoorKnockingPageGate {...props} preselectedListId={42} />)
    expect(screen.getByTestId('native-door-knocking')).toHaveAttribute(
      'data-preselected-list',
      '42',
    )
  })

  it('hands a carried recommended variant to the native experience', () => {
    setState({ ready: true, enabled: true })
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

  // Milestone 2. The entitlement moves to the one paid write — the create
  // flow's Build route — so a free Win candidate gets the map, the filters
  // and the boundary, and meets the gate where the route is bought.
  it('admits a non-Pro campaign when the in-flow gate flag is on', () => {
    setState({ ready: true, enabled: true })
    proGatingState.enabled = true
    render(<DoorKnockingPageGate {...props} campaign={{} as Campaign} />)
    expect(screen.getByTestId('native-door-knocking')).toBeInTheDocument()
    expect(screen.queryByText('Door knocking is a Pro feature')).toBeNull()
  })

  // Admitted either way with the flag on, so there is nothing the
  // elected-office answer could still change — waiting on it would be a
  // spinner in front of a page that is already allowed.
  it('does not wait on the elected-office query when the in-flow gate flag is on', () => {
    setState({ ready: true, enabled: true }, null, true)
    proGatingState.enabled = true
    render(<DoorKnockingPageGate {...props} campaign={{} as Campaign} />)
    expect(screen.getByTestId('native-door-knocking')).toBeInTheDocument()
  })

  // An unsettled gate flag is the one window where either answer would be
  // wrong on screen: rendering the lock flashes an upgrade card at a
  // candidate who is about to be let in, and rendering the page flashes a map
  // at one who is about to be locked out.
  it('holds the spinner for a non-Pro campaign while the in-flow gate flag is unsettled', () => {
    setState({ ready: true, enabled: true })
    proGatingState.ready = false
    proGatingState.enabled = true
    render(<DoorKnockingPageGate {...props} campaign={{} as Campaign} />)
    expect(screen.queryByTestId('native-door-knocking')).toBeNull()
    expect(screen.queryByText('Door knocking is a Pro feature')).toBeNull()
  })

  // A Pro campaign is entitled whatever the gate flag says, so it must not be
  // held behind a second flag read either.
  it('renders the native experience for a Pro campaign while the gate flag is unsettled', () => {
    setState({ ready: true, enabled: true })
    proGatingState.ready = false
    render(<DoorKnockingPageGate {...props} />)
    expect(screen.getByTestId('native-door-knocking')).toBeInTheDocument()
  })

  it('renders the native experience with no list carried in', () => {
    setState({ ready: true, enabled: true })
    render(<DoorKnockingPageGate {...props} />)
    expect(screen.getByTestId('native-door-knocking')).toHaveAttribute(
      'data-preselected-list',
      'undefined',
    )
  })
})
