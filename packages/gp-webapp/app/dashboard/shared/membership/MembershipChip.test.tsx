import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import { CAMPAIGN_VERIFICATION_PATH } from 'app/dashboard/campaign-verification/campaignVerificationPath'
import type { MembershipState } from './deriveMembershipState'
import { MEMBERSHIP_COPY } from './membershipCopy'
import { MembershipChip } from './MembershipChip'

const { mockUseMembershipState } = vi.hoisted(() => ({
  mockUseMembershipState: vi.fn(),
}))

const { mockSmsCompliance } = vi.hoisted(() => ({
  mockSmsCompliance: {
    current: {
      smsCompliance: 'open',
      smsCutoffDate: null,
      generalElectionDate: null,
    } as {
      smsCompliance: string
      smsCutoffDate: string | null
      generalElectionDate: string | null
    },
  },
}))
vi.mock('app/dashboard/shared/smsCutoff/useSmsCompliance', () => ({
  useSmsCompliance: () => mockSmsCompliance.current,
}))

vi.mock('./useMembershipState', () => ({
  useMembershipState: (...args: unknown[]) => mockUseMembershipState(...args),
}))
vi.mock('./ProPitchDialog', () => ({
  ProPitchDialog: ({ open }: { open: boolean }) => (
    <div>pitch:{String(open)}</div>
  ),
}))
vi.mock('./PinDialog', () => ({
  PinDialog: ({ open }: { open: boolean }) => <div>pin:{String(open)}</div>,
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const membership = (
  overrides: Partial<MembershipState> = {},
): MembershipState => ({
  tier: 'pro',
  texting: 'needs_verification',
  pinDelivery: null,
  isElectedOffice: false,
  ...overrides,
})

const setup = ({
  ready = true,
  state = membership(),
}: {
  ready?: boolean
  state?: MembershipState
} = {}) => {
  mockUseMembershipState.mockReturnValue({
    ready,
    state: ready ? state : null,
    tcrCompliance: ready ? { status: 'submitted' } : null,
  })
  return render(<MembershipChip />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSmsCompliance.current = {
    smsCompliance: 'open',
    smsCutoffDate: null,
    generalElectionDate: null,
  }
})

describe('MembershipChip', () => {
  it('renders nothing before the membership state is ready', () => {
    setup({ ready: false })

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders the price for a free campaign and opens the pitch dialog', async () => {
    const user = userEvent.setup()
    setup({ state: membership({ tier: 'free' }) })

    expect(screen.getByText(MEMBERSHIP_COPY.chip.joinLead)).toBeInTheDocument()
    expect(screen.getByText(MEMBERSHIP_COPY.chip.joinTail)).toBeInTheDocument()
    expect(screen.queryByText(/^pitch:/)).toBeNull()

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('pitch:true')).toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Membership.BannerClicked,
      { path: '/' },
    )
  })

  it('routes a Pro campaign that needs verification to the verification flow', async () => {
    const user = userEvent.setup()
    setup()

    expect(
      screen.getByText(MEMBERSHIP_COPY.chip.needsVerification),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button'))

    expect(router.push).toHaveBeenCalledWith(CAMPAIGN_VERIFICATION_PATH)
  })

  it('renders the PIN prompt and opens the PIN dialog', async () => {
    const user = userEvent.setup()
    setup({ state: membership({ texting: 'awaiting_pin' }) })

    expect(
      screen.getByText(MEMBERSHIP_COPY.chip.awaitingPin),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^pin:/)).toBeNull()

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('pin:true')).toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Membership.PinBannerClicked,
      { path: '/' },
    )
  })

  it('renders the in-review label as a status, not a disabled button', () => {
    setup({ state: membership({ texting: 'in_review' }) })

    expect(screen.getByRole('status')).toHaveTextContent(
      MEMBERSHIP_COPY.chip.inReview,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('counts down to the cutoff while the window is closing', () => {
    mockSmsCompliance.current = {
      smsCompliance: 'closing',
      smsCutoffDate: '2026-10-15',
      generalElectionDate: '2026-11-03',
    }
    setup()

    expect(screen.getByRole('button')).toHaveTextContent(
      'Verify to send SMS by Oct. 15',
    )
  })

  it('renders nothing once texting is closed for a Pro campaign', () => {
    mockSmsCompliance.current = {
      smsCompliance: 'closed',
      smsCutoffDate: '2026-10-15',
      generalElectionDate: '2026-11-03',
    }
    setup({ state: membership({ texting: 'closed' }) })

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('renders nothing once a Pro campaign is cleared to text', () => {
    setup({ state: membership({ texting: 'cleared' }) })

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing for an elected-office organization', () => {
    setup({ state: membership({ isElectedOffice: true }) })

    expect(screen.queryByRole('button')).toBeNull()
  })
})
