import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { render } from 'helpers/test-utils/render'
import type { Campaign } from 'helpers/types'
import type { MembershipState } from 'app/dashboard/shared/membership/deriveMembershipState'
import type { OutreachDetail } from '@goodparty_org/contracts'
import type { ComposeRequest } from 'app/dashboard/outreach/components/OutreachComposeDeepLink'
import { OutreachHubPage } from './OutreachHubPage'
import type { HistoryRow } from './historyStatus.util'

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
  SmsFlow: ({ open, resumeDraft }: FlowStubProps) =>
    open ? (
      <div data-testid="sms-flow">
        {resumeDraft ? `resuming ${resumeDraft.id}` : 'fresh'}
      </div>
    ) : null,
}))
vi.mock('./OutreachDetailsDrawer', () => ({
  OutreachDetailsDrawer: ({ row }: { row: { name?: string | null } | null }) =>
    row ? <div data-testid="details-drawer">{row.name}</div> : null,
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
    <button type="button" onClick={() => onCompose({ type: 'text' })}>
      compose text
    </button>
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

// A draft row is the campaign's way back into the flow that saved it, so it
// reopens that flow on the saved row rather than the read-only drawer.
describe('OutreachHubPage — clicking a draft row resumes its flow', () => {
  beforeEach(() => {
    mockUseFlag.mockReturnValue({ ready: true, enabled: true })
    mockUseMembershipState.mockReturnValue({
      ready: true,
      state: membership({ tier: 'free', texting: 'needs_verification' }),
      tcrCompliance: null,
    })
    mockFetchOutreachDetail.mockReset()
  })

  it('opens the text flow on the saved draft', async () => {
    mockFetchOutreachDetail.mockResolvedValue({ id: 99, name: 'Draft blast' })
    renderHub([draftRow, sentRow])

    await userEvent.click(within(desktopTable()).getByText('Draft blast'))

    expect(await screen.findByTestId('sms-flow')).toHaveTextContent(
      'resuming 99',
    )
    expect(mockFetchOutreachDetail).toHaveBeenCalledWith(99)
    expect(screen.queryByTestId('details-drawer')).not.toBeInTheDocument()
  })

  it('opens the robocall flow on a robocall draft', async () => {
    mockFetchOutreachDetail.mockResolvedValue({ id: 77, name: 'Draft call' })
    renderHub([robocallDraftRow, sentRow])

    await userEvent.click(within(desktopTable()).getByText('Draft call'))

    expect(await screen.findByTestId('robocall-flow')).toHaveTextContent(
      'resuming 77',
    )
    expect(screen.queryByTestId('details-drawer')).not.toBeInTheDocument()
  })

  // A failed detail read must not be a dead end: the flow opens as a new
  // campaign, and the saved row is still there to try again from.
  it('opens a fresh flow when the draft detail cannot be read', async () => {
    mockFetchOutreachDetail.mockRejectedValue(new Error('nope'))
    renderHub([draftRow, sentRow])

    await userEvent.click(within(desktopTable()).getByText('Draft blast'))

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
})
