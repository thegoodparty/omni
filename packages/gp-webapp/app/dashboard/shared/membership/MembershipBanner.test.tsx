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
import { MembershipBanner, resolveMembershipAction } from './MembershipBanner'

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
  state?: MembershipState | null
} = {}) => {
  mockUseFlag.mockReturnValue({ ready: true, enabled })
  mockUseMembershipState.mockReturnValue({
    ready,
    state: ready ? state : null,
    tcrCompliance: ready ? { status: 'submitted' } : null,
  })
  return render(<MembershipBanner />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveMembershipAction', () => {
  it('maps each membership state to its next step', () => {
    expect(resolveMembershipAction(membership({ tier: 'free' }))).toBe('pitch')
    expect(
      resolveMembershipAction(membership({ texting: 'needs_verification' })),
    ).toBe('verify')
    expect(
      resolveMembershipAction(membership({ texting: 'awaiting_pin' })),
    ).toBe('pin')
    expect(resolveMembershipAction(membership({ texting: 'in_review' }))).toBe(
      null,
    )
    expect(resolveMembershipAction(membership({ texting: 'cleared' }))).toBe(
      null,
    )
    expect(
      resolveMembershipAction(
        membership({ tier: 'free', isElectedOffice: true }),
      ),
    ).toBe(null)
  })
})

describe('MembershipBanner', () => {
  it('renders nothing, and reads nothing, when the flag is off', () => {
    setup({ enabled: false, state: membership({ tier: 'free' }) })

    expect(screen.queryByRole('button')).toBeNull()
    expect(trackEvent).not.toHaveBeenCalled()
    // The membership reads are the flag's cost, not just its UI: a
    // flagged-off user must not pay for the TCR / Peerly queries.
    expect(mockUseMembershipState).toHaveBeenCalledWith({ enabled: false })
  })

  it('renders nothing before the membership state is ready', () => {
    setup({ ready: false })

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('exposes the flag once, and only once the banner is on screen', () => {
    setup()

    // The hook read must not expose: the treatable population is the one that
    // can see a membership surface, not everyone the flag is on for.
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

  it('renders the upsell and opens the pitch dialog for a free campaign', async () => {
    const user = userEvent.setup()
    setup({ state: membership({ tier: 'free' }) })

    expect(
      screen.getByText(MEMBERSHIP_COPY.banner.free.body),
    ).toBeInTheDocument()
    expect(screen.getByText(MEMBERSHIP_COPY.banner.free.cta)).toBeVisible()
    // Mounted on demand: nothing of the dialog exists until it is opened.
    expect(screen.queryByText(/^pitch:/)).toBeNull()

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('pitch:true')).toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Membership.BannerClicked,
      { action: 'pitch' },
    )
  })

  it('routes a Pro campaign that needs verification to the verification flow', async () => {
    const user = userEvent.setup()
    setup({ state: membership({ texting: 'needs_verification' }) })

    expect(
      screen.getByText(MEMBERSHIP_COPY.banner.needsVerification.body),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button'))

    expect(router.push).toHaveBeenCalledWith(CAMPAIGN_VERIFICATION_PATH)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Membership.BannerClicked,
      { action: 'verify' },
    )
  })

  it('opens the PIN dialog when a PIN is waiting', async () => {
    const user = userEvent.setup()
    setup({ state: membership({ texting: 'awaiting_pin' }) })

    expect(
      screen.getByText(MEMBERSHIP_COPY.banner.awaitingPin.body),
    ).toBeInTheDocument()
    // PinDialog runs a live Peerly read through useCvPinGate, so it must not
    // be mounted until the candidate asks for it.
    expect(screen.queryByText(/^pin:/)).toBeNull()

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('pin:true')).toBeInTheDocument()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('renders the in-review body with no CTA and no action', async () => {
    const user = userEvent.setup()
    setup({ state: membership({ texting: 'in_review' }) })

    expect(
      screen.getByText(MEMBERSHIP_COPY.banner.inReview.body),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(MEMBERSHIP_COPY.banner.needsVerification.cta),
    ).toBeNull()
    // A disabled button is unreachable by keyboard and screen reader, so the
    // in-review copy is a status instead.
    expect(screen.getByRole('status')).toHaveTextContent(
      MEMBERSHIP_COPY.banner.inReview.body,
    )
    expect(screen.queryByRole('button')).toBeNull()

    await user.click(screen.getByRole('status'))

    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Membership.BannerClicked,
      expect.anything(),
    )
  })

  it('renders nothing once a Pro campaign is cleared to text', () => {
    setup({ state: membership({ texting: 'cleared' }) })

    expect(screen.queryByRole('button')).toBeNull()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('keeps the upsell for a lapsed Pro campaign whose texting is still cleared', () => {
    setup({ state: membership({ tier: 'free', texting: 'cleared' }) })

    expect(
      screen.getByText(MEMBERSHIP_COPY.banner.free.body),
    ).toBeInTheDocument()
    expect(screen.getByText('See what you get')).toBeVisible()
  })

  it('renders nothing for an elected-office organization', () => {
    setup({ state: membership({ isElectedOffice: true }) })

    expect(screen.queryByRole('button')).toBeNull()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('reports the membership state when the banner becomes visible', () => {
    setup({ state: membership({ texting: 'awaiting_pin' }) })

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Membership.BannerViewed,
      { tier: 'pro', texting: 'awaiting_pin' },
    )
  })
})
