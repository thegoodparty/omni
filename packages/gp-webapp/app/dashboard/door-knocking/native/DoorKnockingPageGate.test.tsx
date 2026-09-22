import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Campaign } from 'helpers/types'
import { router } from 'helpers/test-utils/router-mocking'
import DoorKnockingPageGate from './DoorKnockingPageGate'

const flagState = { ready: true, enabled: false }
const orgState: { slug: string } = { slug: 'some-campaign' }
const electedOfficeState: { data: object | null; isPending: boolean } = {
  data: null,
  isPending: false,
}

vi.mock('app/shared/experiments/nativeDoorKnockingFlag', () => ({
  useNativeDoorKnockingFlag: () => flagState,
}))
vi.mock('@shared/hooks/useElectedOffice', () => ({
  useElectedOffice: () => electedOfficeState,
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => orgState,
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
  orgState.slug = 'some-campaign'
}

describe('DoorKnockingPageGate', () => {
  // The router mock is module-level, so a bounce asserted in one test is still
  // recorded in the next one's counts.
  beforeEach(() => {
    router.replace?.mockClear()
  })

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

  // A Serve org has no control arm to fall back to: the eCanvasser dashboard
  // reports a third-party integration only a campaign can connect, and door
  // knocking reached the Serve rail already native. Off the flag this route
  // does not exist for them, so they go back to the hub the card sits on.
  it('bounces a flag-off Serve org to the constituent outreach hub', () => {
    setState({ ready: true, enabled: false })
    orgState.slug = 'eo-city-council'
    render(<DoorKnockingPageGate {...props} campaign={null} />)
    expect(screen.queryByTestId('ecanvasser-dashboard')).toBeNull()
    expect(screen.queryByTestId('native-door-knocking')).toBeNull()
    expect(router.replace).toHaveBeenCalledWith(
      '/dashboard/constituent-outreach',
    )
  })

  // Read off the slug rather than the async elected-office query, so a
  // control-arm candidate never waits on it to see their own page.
  it('leaves the control arm alone for a campaign org', () => {
    setState({ ready: true, enabled: false })
    render(<DoorKnockingPageGate {...props} campaign={{} as Campaign} />)
    expect(screen.getByTestId('ecanvasser-dashboard')).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  // An unsettled flag is not an off flag: bouncing on it would race a Serve
  // org off their own map on every cold load.
  it('does not bounce a Serve org while the flag is unsettled', () => {
    setState({ ready: false, enabled: false })
    orgState.slug = 'eo-city-council'
    render(<DoorKnockingPageGate {...props} campaign={null} />)
    expect(router.replace).not.toHaveBeenCalled()
  })

  // Control has an entitlement of its own: without the eCanvasser connection
  // candidate success provisions, every panel on that dashboard reads zero.
  it('shows the unavailable card for a flag-off campaign with no eCanvasser', () => {
    setState({ ready: true, enabled: false })
    render(
      <DoorKnockingPageGate
        {...props}
        campaign={{} as Campaign}
        hasEcanvasser={false}
      />,
    )
    expect(screen.queryByTestId('ecanvasser-dashboard')).toBeNull()
    expect(
      screen.getByText("Door knocking isn't turned on for your campaign"),
    ).toBeVisible()
  })

  it('renders the eCanvasser dashboard for a connected campaign', () => {
    setState({ ready: true, enabled: false })
    render(
      <DoorKnockingPageGate
        {...props}
        campaign={{} as Campaign}
        hasEcanvasser={true}
      />,
    )
    expect(screen.getByTestId('ecanvasser-dashboard')).toBeInTheDocument()
  })

  // Unsettled is not a refusal: a failed or slow server read must not tell a
  // connected campaign their feature is off.
  it('falls back to the dashboard when the eCanvasser read is unavailable', () => {
    setState({ ready: true, enabled: false })
    render(<DoorKnockingPageGate {...props} campaign={{} as Campaign} />)
    expect(screen.getByTestId('ecanvasser-dashboard')).toBeInTheDocument()
  })

  // The Serve bounce runs first, so a Serve org never reaches the card that
  // names a campaign.
  it('still bounces a flag-off Serve org rather than showing the card', () => {
    setState({ ready: true, enabled: false })
    orgState.slug = 'eo-city-council'
    render(
      <DoorKnockingPageGate {...props} campaign={null} hasEcanvasser={false} />,
    )
    expect(
      screen.queryByText("Door knocking isn't turned on for your campaign"),
    ).toBeNull()
    expect(router.replace).toHaveBeenCalledWith(
      '/dashboard/constituent-outreach',
    )
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
