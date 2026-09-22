import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import { CAMPAIGN_VERIFICATION_PATH } from 'app/dashboard/campaign-verification/campaignVerificationPath'
import { OUTREACH_PRO_GATING_V2_FLAG_KEY } from 'app/shared/experiments/outreachProGatingV2Flag'
import type { MembershipState } from './deriveMembershipState'
import { MEMBERSHIP_COPY } from './membershipCopy'
import { MembershipChip } from './MembershipChip'

const { mockUseMembershipState, mockUseFlag, mockExposure } = vi.hoisted(
  () => ({
    mockUseMembershipState: vi.fn(),
    mockUseFlag: vi.fn(),
    mockExposure: vi.fn(),
  }),
)

vi.mock('./useMembershipState', () => ({
  useMembershipState: (...args: unknown[]) => mockUseMembershipState(...args),
}))
vi.mock('app/shared/experiments/outreachProGatingV2Flag', () => ({
  OUTREACH_PRO_GATING_V2_FLAG_KEY: 'outreach-pro-gating-v2',
  useOutreachProGatingV2Flag: (...args: unknown[]) => mockUseFlag(...args),
}))
vi.mock('app/shared/experiments/FeatureFlagsProvider', () => ({
  useFeatureFlags: () => ({ exposure: mockExposure }),
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
  enabled = true,
  ready = true,
  state = membership(),
}: {
  enabled?: boolean
  ready?: boolean
  state?: MembershipState
} = {}) => {
  mockUseFlag.mockReturnValue({ ready: true, enabled })
  mockUseMembershipState.mockReturnValue({
    ready,
    state: ready ? state : null,
    tcrCompliance: ready ? { status: 'submitted' } : null,
  })
  return render(<MembershipChip />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MembershipChip', () => {
  it('renders nothing, and reads nothing, when the flag is off', () => {
    setup({ enabled: false, state: membership({ tier: 'free' }) })

    expect(screen.queryByRole('button')).toBeNull()
    expect(mockUseMembershipState).toHaveBeenCalledWith({ enabled: false })
  })

  it('renders nothing before the membership state is ready', () => {
    setup({ ready: false })

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('exposes the flag once, so phone-only candidates are counted too', () => {
    setup()

    expect(mockUseFlag).toHaveBeenCalledWith(false)
    expect(mockExposure).toHaveBeenCalledTimes(1)
    expect(mockExposure).toHaveBeenCalledWith(OUTREACH_PRO_GATING_V2_FLAG_KEY)
    expect(mockUseMembershipState).toHaveBeenCalledWith({ enabled: true })
  })

  it('does not expose the flag when the surface is hidden', () => {
    for (const state of [
      membership({ isElectedOffice: true }),
      membership({ texting: 'cleared' }),
    ]) {
      setup({ state })

      expect(mockExposure).not.toHaveBeenCalled()
      mockExposure.mockClear()
    }
  })

  it('does not expose the flag before the membership state is ready', () => {
    setup({ ready: false })

    expect(mockExposure).not.toHaveBeenCalled()
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
      EVENTS.ProUpgrade.Membership.ChipClicked,
      { action: 'pitch' },
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
      EVENTS.ProUpgrade.Membership.ChipClicked,
      { action: 'pin' },
    )
  })

  it('renders the in-review label as a status, not a disabled button', () => {
    setup({ state: membership({ texting: 'in_review' }) })

    expect(screen.getByRole('status')).toHaveTextContent(
      MEMBERSHIP_COPY.chip.inReview,
    )
    expect(screen.queryByRole('button')).toBeNull()
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
