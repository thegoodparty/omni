import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import type { Campaign } from 'helpers/types'
import type { MembershipState } from 'app/dashboard/shared/membership/deriveMembershipState'
import type { OutreachDetail } from '@goodparty_org/contracts'
import type { ComposeRequest } from 'app/dashboard/outreach/components/OutreachComposeDeepLink'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { OutreachHubPage } from './OutreachHubPage'
import type { HistoryRow } from './historyStatus.util'
import { DRAFT_FOOTER_LABELS } from './listDetails/footerMode'

// The desktop history table, scoped so its content isn't confused with the
// mobile card list (also in the DOM, hidden via CSS) — same convention as
// OutreachHistoryTable.test.tsx.
const desktopTable = () => screen.getAllByRole('table')[0] as HTMLElement

// This suite is only about the drafts gate wired through the hub — the tile
// grid and the send flows are exercised by their own test files, and
// mounting them for real here would need a campaign/elected-office/flag
// fixture apparatus this file has no use for.
vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('./ChannelTileGrid', () => ({
  ChannelTileGrid: () => null,
}))
vi.mock('./social/SocialFlow', () => ({ SocialFlow: () => null }))
vi.mock('./phone-banking/PhoneBankingFlow', () => ({
  PhoneBankingFlow: () => null,
}))

// The two resumable flows and the drawer stand in for themselves, so a row
// click can be asserted by where it landed and on which draft. Written out
// per factory rather than shared: a vi.mock factory runs during the import
// below, before any module-scope const in this file exists.
interface FlowStubProps {
  open: boolean
  resumeDraft?: OutreachDetail | null
  source?: string
  resumeCta?: string
}
vi.mock('./robocall/RobocallFlow', () => ({
  RobocallFlow: ({ open, resumeDraft }: FlowStubProps) =>
    open ? (
      <div data-testid="robocall-flow">
        {resumeDraft ? `resuming ${resumeDraft.id}` : 'fresh'}
      </div>
    ) : null,
}))
vi.mock('./sms/SmsFlow', () => ({
  SmsFlow: ({ open, resumeDraft, source, resumeCta }: FlowStubProps) =>
    open ? (
      <div data-testid="sms-flow" data-source={source} data-cta={resumeCta}>
        {resumeDraft ? `resuming ${resumeDraft.id}` : 'fresh'}
      </div>
    ) : null,
}))
// The drawer's draft footer CTA is the hub's `onResumeDraft`, so the stand-in
// exposes it as a button.
vi.mock('./OutreachDetailsDrawer', () => ({
  OutreachDetailsDrawer: ({
    row,
    onResumeDraft,
  }: {
    row: HistoryRow | null
    onResumeDraft?: (row: HistoryRow) => void
  }) =>
    row ? (
      <div data-testid="details-drawer">
        {row.name}
        <button type="button" onClick={() => onResumeDraft?.(row)}>
          resume draft
        </button>
      </div>
    ) : null,
}))

const { mockFetchOutreachDetail } = vi.hoisted(() => ({
  mockFetchOutreachDetail: vi.fn(),
}))
vi.mock('./useOutreachDetail', () => ({
  outreachDetailQueryPrefix: ['outreach-detail'],
  outreachDetailQueryKey: (id: number) => ['outreach-detail', id],
  fetchOutreachDetail: (id: number) => mockFetchOutreachDetail(id),
  useOutreachDetail: () => ({ data: undefined, isLoading: false }),
  useSeedOutreachDetail: () => vi.fn(),
}))
// The deep link hands the hub a resolved request and mounts nothing of its
// own, so the stand-in is just a way to fire one.
vi.mock('app/dashboard/outreach/components/OutreachComposeDeepLink', () => ({
  OutreachComposeDeepLink: ({
    onCompose,
  }: {
    onCompose: (request: ComposeRequest) => void
  }) => (
    <>
      <button type="button" onClick={() => onCompose({ type: 'text' })}>
        compose text
      </button>
      <button
        type="button"
        onClick={() => onCompose({ type: 'text', source: 'campaign_tracker' })}
      >
        compose text from the plan
      </button>
    </>
  ),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const { mockUseFlag, mockUseMembershipState } = vi.hoisted(() => ({
  mockUseFlag: vi.fn(),
  mockUseMembershipState: vi.fn(),
}))
vi.mock('app/shared/experiments/outreachProGatingV2Flag', () => ({
  useOutreachProGatingV2Flag: (...args: unknown[]) => mockUseFlag(...args),
}))
vi.mock('app/dashboard/shared/membership/useMembershipState', () => ({
  useMembershipState: (...args: unknown[]) => mockUseMembershipState(...args),
}))

const membership = (
  overrides: Partial<MembershipState> = {},
): MembershipState => ({
  tier: 'pro',
  texting: 'cleared',
  pinDelivery: null,
  isElectedOffice: false,
  ...overrides,
})

const draftRow: HistoryRow = {
  id: 99,
  createdAt: '2026-09-01T00:00:00Z',
  outreachType: 'p2p',
  name: 'Draft blast',
  status: 'draft',
  phoneListId: null,
}

const sentRow: HistoryRow = {
  id: 1,
  createdAt: '2026-08-01T00:00:00Z',
  outreachType: 'socialMedia',
  name: 'Intro post',
  status: 'completed',
}

const campaign = { id: 1 } as Campaign

describe('OutreachHubPage — draft rows gate', () => {
  it('hides draft rows and keeps the membership query idle when the flag is off', () => {
    mockUseFlag.mockReturnValue({ ready: true, enabled: false })
    mockUseMembershipState.mockReturnValue({
      ready: false,
      state: null,
      tcrCompliance: null,
    })

    render(
      <OutreachHubPage
        pathname="/dashboard/outreach"
        campaign={campaign}
        outreaches={[draftRow, sentRow]}
      />,
    )

    const table = within(desktopTable())
    expect(table.getByText('Intro post')).toBeInTheDocument()
    expect(table.queryByText('Draft blast')).not.toBeInTheDocument()
    expect(mockUseMembershipState).toHaveBeenCalledWith({ enabled: false })
  })

  it('shows a draft row labeled by the next step, reading membership through the table', () => {
    mockUseFlag.mockReturnValue({ ready: true, enabled: true })
    mockUseMembershipState.mockReturnValue({
      ready: true,
      state: membership({ tier: 'pro', texting: 'awaiting_pin' }),
      tcrCompliance: { status: 'submitted' },
    })

    render(
      <OutreachHubPage
        pathname="/dashboard/outreach"
        campaign={campaign}
        outreaches={[draftRow, sentRow]}
      />,
    )

    const table = within(desktopTable())
    expect(table.getByText('Draft blast')).toBeInTheDocument()
    expect(table.getByText('PIN needed')).toBeInTheDocument()
    expect(mockUseMembershipState).toHaveBeenCalledWith({ enabled: true })
  })
})

const robocallDraftRow: HistoryRow = {
  id: 77,
  createdAt: '2026-09-02T00:00:00Z',
  outreachType: 'robocall',
  name: 'Draft call',
  status: 'draft',
}

const renderHub = (outreaches: HistoryRow[]) =>
  render(
    <OutreachHubPage
      pathname="/dashboard/outreach"
      campaign={campaign}
      outreaches={outreaches}
    />,
  )

// A draft row opens the drawer like every other row; the drawer's footer CTA
// (design: the `verify` footer) is what sends it back into the flow that
// saved it.
describe('OutreachHubPage — resuming a draft from its drawer', () => {
  beforeEach(() => {
    mockUseFlag.mockReturnValue({ ready: true, enabled: true })
    mockUseMembershipState.mockReturnValue({
      ready: true,
      state: membership({ tier: 'free', texting: 'needs_verification' }),
      tcrCompliance: null,
    })
    mockFetchOutreachDetail.mockReset()
  })

  it('opens the drawer on a draft row, whose CTA resumes the text flow', async () => {
    mockFetchOutreachDetail.mockResolvedValue({ id: 99, name: 'Draft blast' })
    renderHub([draftRow, sentRow])

    await userEvent.click(within(desktopTable()).getByText('Draft blast'))
    expect(await screen.findByTestId('details-drawer')).toHaveTextContent(
      'Draft blast',
    )
    expect(screen.queryByTestId('sms-flow')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'resume draft' }))

    expect(await screen.findByTestId('sms-flow')).toHaveTextContent(
      'resuming 99',
    )
    expect(mockFetchOutreachDetail).toHaveBeenCalledWith(99)
  })

  it('resumes the robocall flow from a robocall draft', async () => {
    mockFetchOutreachDetail.mockResolvedValue({ id: 77, name: 'Draft call' })
    renderHub([robocallDraftRow, sentRow])

    await userEvent.click(within(desktopTable()).getByText('Draft call'))
    await userEvent.click(
      await screen.findByRole('button', { name: 'resume draft' }),
    )

    expect(await screen.findByTestId('robocall-flow')).toHaveTextContent(
      'resuming 77',
    )
  })

  // A failed detail read must not be a dead end: the flow opens as a new
  // campaign, and the saved row is still there to try again from.
  it('opens a fresh flow when the draft detail cannot be read', async () => {
    mockFetchOutreachDetail.mockRejectedValue(new Error('nope'))
    renderHub([draftRow, sentRow])

    await userEvent.click(within(desktopTable()).getByText('Draft blast'))
    await userEvent.click(
      await screen.findByRole('button', { name: 'resume draft' }),
    )

    expect(await screen.findByTestId('sms-flow')).toHaveTextContent('fresh')
  })

  // A tracker/manager CTA lands on the same one-draft-per-channel rule the
  // tile does, so it resumes rather than starting a text the server would
  // refuse.
  it('resumes the saved draft when a compose deep link asks for that channel', async () => {
    mockFetchOutreachDetail.mockResolvedValue({ id: 99, name: 'Draft blast' })
    renderHub([draftRow, sentRow])

    await userEvent.click(screen.getByRole('button', { name: 'compose text' }))

    expect(await screen.findByTestId('sms-flow')).toHaveTextContent(
      'resuming 99',
    )
    expect(mockFetchOutreachDetail).toHaveBeenCalledWith(99)
  })

  it('opens the drawer for a row that is not a draft', async () => {
    renderHub([draftRow, sentRow])

    await userEvent.click(within(desktopTable()).getByText('Intro post'))

    expect(await screen.findByTestId('details-drawer')).toHaveTextContent(
      'Intro post',
    )
    expect(screen.queryByTestId('sms-flow')).not.toBeInTheDocument()
    expect(mockFetchOutreachDetail).not.toHaveBeenCalled()
  })

  it('reports the resume with the source that opened it', async () => {
    vi.mocked(trackEvent).mockClear()
    mockFetchOutreachDetail.mockResolvedValue({ id: 99, name: 'Draft blast' })
    renderHub([draftRow, sentRow])

    await userEvent.click(within(desktopTable()).getByText('Draft blast'))
    await userEvent.click(
      await screen.findByRole('button', { name: 'resume draft' }),
    )
    await screen.findByTestId('sms-flow')

    expect(vi.mocked(trackEvent)).toHaveBeenCalledWith(
      EVENTS.Outreach.Draft.Resumed,
      { channel: 'sms', source: 'row' },
    )
  })

  it('reports a deep-link resume as its own source', async () => {
    vi.mocked(trackEvent).mockClear()
    mockFetchOutreachDetail.mockResolvedValue({ id: 99, name: 'Draft blast' })
    renderHub([draftRow, sentRow])

    await userEvent.click(screen.getByRole('button', { name: 'compose text' }))
    await screen.findByTestId('sms-flow')

    expect(vi.mocked(trackEvent)).toHaveBeenCalledWith(
      EVENTS.Outreach.Draft.Resumed,
      { channel: 'sms', source: 'deep_link' },
    )
  })

  // Nothing was resumed, so there is nothing to report.
  it('reports no resume when the flow opens fresh', async () => {
    vi.mocked(trackEvent).mockClear()
    renderHub([sentRow])

    await userEvent.click(screen.getByRole('button', { name: 'compose text' }))
    await screen.findByTestId('sms-flow')

    expect(vi.mocked(trackEvent)).not.toHaveBeenCalledWith(
      EVENTS.Outreach.Draft.Resumed,
      expect.anything(),
    )
  })
})

// The list arrives as a server-rendered snapshot held in `useState`, so it
// is only as fresh as the last time this route's RSC ran — and coming back
// from another route can be served from the client router cache without
// re-running it. Anything written while away is missing until something
// asks again.
describe('OutreachHubPage — a list written while away', () => {
  beforeEach(() => {
    mockUseFlag.mockReturnValue({ ready: true, enabled: true })
    mockUseMembershipState.mockReturnValue({
      ready: true,
      state: membership({ tier: 'free', texting: 'needs_verification' }),
      tcrCompliance: null,
    })
    mockFetchOutreachDetail.mockReset()
  })

  const freshRow = {
    ...sentRow,
    id: 4242,
    name: 'Introduction walk',
    outreachType: 'doorKnocking',
  } as unknown as typeof sentRow

  it('asks the server once on mount, so a campaign made while away appears', async () => {
    // The seeded snapshot predates the campaign; the refetch is what puts it
    // on the table.
    api.mock('GET /v1/outreach', { status: 200, data: [sentRow, freshRow] })
    renderHub([sentRow])

    expect(
      await within(desktopTable()).findByText('Introduction walk'),
    ).toBeInTheDocument()
  })

  it('opens a deep link to a campaign the snapshot never carried', async () => {
    // The consume-once ref used to be set BEFORE the lookup, so a link to a
    // row the snapshot lacked spent the param and could never open — which
    // is exactly the campaign a candidate has this second created and been
    // handed back from a walk.
    api.mock('GET /v1/outreach', { status: 200, data: [sentRow, freshRow] })
    mockFetchOutreachDetail.mockResolvedValue({
      id: 4242,
      name: 'Introduction walk',
    })

    render(
      <OutreachHubPage
        pathname="/dashboard/outreach"
        campaign={campaign}
        outreaches={[sentRow]}
        initialOutreachId={4242}
      />,
    )

    expect(await screen.findByTestId('details-drawer')).toHaveTextContent(
      'Introduction walk',
    )
  })

  it('keeps the deep link when the refetch fails', async () => {
    // Settling on a failed GET would spend the param against the seeded
    // snapshot, which is the one list that cannot carry the new campaign.
    api.mock('GET /v1/outreach', { status: 500, data: { error: 'boom' } })
    router.replace?.mockClear()

    render(
      <OutreachHubPage
        pathname="/dashboard/outreach"
        campaign={campaign}
        outreaches={[sentRow]}
        initialOutreachId={4242}
      />,
    )

    expect(
      await within(desktopTable()).findByText('Intro post'),
    ).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(router.replace).not.toHaveBeenCalled()
    expect(screen.queryByTestId('details-drawer')).not.toBeInTheDocument()
  })
})

describe('OutreachHubPage flow source', () => {
  beforeEach(() => {
    mockUseFlag.mockReturnValue({ ready: true, enabled: true })
    mockUseMembershipState.mockReturnValue({
      ready: true,
      state: membership({ tier: 'free', texting: 'needs_verification' }),
      tcrCompliance: null,
    })
    mockFetchOutreachDetail.mockReset()
  })

  it('opens a draft row as a draft, with the footer label that resumed it', async () => {
    mockFetchOutreachDetail.mockResolvedValue({ id: 99, name: 'Draft blast' })
    renderHub([draftRow, sentRow])

    await userEvent.click(within(desktopTable()).getByText('Draft blast'))
    await userEvent.click(
      await screen.findByRole('button', { name: 'resume draft' }),
    )
    const flow = await screen.findByTestId('sms-flow')

    expect(flow).toHaveAttribute('data-source', 'draft')
    expect(flow).toHaveAttribute('data-cta', DRAFT_FOOTER_LABELS.pro)
  })

  it('opens a compose link with no source as a deep link', async () => {
    renderHub([sentRow])

    await userEvent.click(screen.getByRole('button', { name: 'compose text' }))

    expect(await screen.findByTestId('sms-flow')).toHaveAttribute(
      'data-source',
      'deep_link',
    )
  })

  it('reads a campaign tracker compose link as the campaign plan', async () => {
    renderHub([sentRow])

    await userEvent.click(
      screen.getByRole('button', { name: 'compose text from the plan' }),
    )

    const flow = await screen.findByTestId('sms-flow')
    expect(flow).toHaveAttribute('data-source', 'campaign_plan')
    expect(flow).not.toHaveAttribute('data-cta')
  })
})
