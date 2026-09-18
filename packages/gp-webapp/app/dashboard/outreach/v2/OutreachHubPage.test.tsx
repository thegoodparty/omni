import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { render } from 'helpers/test-utils/render'
import type { Campaign } from 'helpers/types'
import type { MembershipState } from 'app/dashboard/shared/membership/deriveMembershipState'
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
vi.mock('./robocall/RobocallFlow', () => ({ RobocallFlow: () => null }))
vi.mock('./phone-banking/PhoneBankingFlow', () => ({
  PhoneBankingFlow: () => null,
}))
vi.mock('./sms/SmsFlow', () => ({ SmsFlow: () => null }))
vi.mock('./OutreachDetailsDrawer', () => ({
  OutreachDetailsDrawer: () => null,
}))
vi.mock('app/dashboard/outreach/components/OutreachComposeDeepLink', () => ({
  OutreachComposeDeepLink: () => null,
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
