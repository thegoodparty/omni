import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import { CAMPAIGN_VERIFICATION_PATH } from 'app/dashboard/campaign-verification/campaignVerificationPath'
import type { MembershipState } from './deriveMembershipState'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import type { Campaign } from 'helpers/types'
import { PLAN_PRICING } from '@goodparty_org/contracts'
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

const { mockPlanFlag } = vi.hoisted(() => ({
  mockPlanFlag: { ready: true, enabled: false },
}))
vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => mockPlanFlag,
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
  registeredVoters,
}: {
  ready?: boolean
  state?: MembershipState
  registeredVoters?: number
} = {}) => {
  mockUseMembershipState.mockReturnValue({
    ready,
    state: ready ? state : null,
    tcrCompliance: ready ? { status: 'submitted' } : null,
  })
  return render(
    <CampaignContext.Provider
      value={[
        { raceTargetMetrics: { registeredVoters } } as unknown as Campaign,
      ]}
    >
      <MembershipChip />
    </CampaignContext.Provider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPlanFlag.ready = true
  mockPlanFlag.enabled = false
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

  it('sends a Pro campaign cleared to text to schedule its text', async () => {
    const user = userEvent.setup()
    setup({ state: membership({ texting: 'cleared' }) })

    expect(screen.getByText(MEMBERSHIP_COPY.chip.cleared)).toBeInTheDocument()

    await user.click(screen.getByRole('button'))

    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/outreach?compose=text&source=navigation',
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Membership.ScheduleBannerClicked,
      { path: '/' },
    )
  })

  it('renders nothing for an elected-office organization', () => {
    setup({ state: membership({ isElectedOffice: true }) })

    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('MembershipChip plan copy', () => {
  it('renders nothing for a free campaign while the flag is loading', () => {
    mockPlanFlag.ready = false
    setup({ state: membership({ tier: 'free' }) })

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reads Upgrade with an arrow, no badge or price, and opens the plan page', async () => {
    const user = userEvent.setup()
    mockPlanFlag.enabled = true
    setup({ state: membership({ tier: 'free' }) })

    const chip = screen.getByRole('button')
    expect(chip).toHaveTextContent(/^Upgrade$/)
    expect(chip.querySelector('svg')).not.toBeNull()
    expect(screen.queryByLabelText('PRO')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByText(MEMBERSHIP_COPY.chip.joinTail)).toBeNull()

    await user.click(chip)

    expect(router.push).toHaveBeenCalledWith('/dashboard/plans')
    expect(screen.queryByText(/^pitch:/)).toBeNull()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Membership.BannerClicked,
      { path: '/' },
    )
  })

  it('reads the same and opens the plan page on Team when Team is recommended', async () => {
    const user = userEvent.setup()
    mockPlanFlag.enabled = true
    setup({
      state: membership({ tier: 'free' }),
      registeredVoters: PLAN_PRICING.teamRecommendVoterThreshold + 1,
    })

    expect(screen.getByRole('button')).toHaveTextContent(/^Upgrade$/)
    expect(screen.queryByRole('img', { name: 'TEAM' })).toBeNull()

    await user.click(screen.getByRole('button'))

    expect(router.push).toHaveBeenCalledWith('/dashboard/plans?highlight=team')
    expect(screen.queryByText(/^pitch:/)).toBeNull()
  })
})
