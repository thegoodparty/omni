import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import { CAMPAIGN_VERIFICATION_PATH } from 'app/dashboard/campaign-verification/campaignVerificationPath'
import type { MembershipState } from './deriveMembershipState'
import { MEMBERSHIP_COPY } from './membershipCopy'
import { MembershipBanner, resolveMembershipAction } from './MembershipBanner'

const { mockUseMembershipState, mockUseFlag } = vi.hoisted(() => ({
  mockUseMembershipState: vi.fn(),
  mockUseFlag: vi.fn(),
}))

vi.mock('./useMembershipState', () => ({
  useMembershipState: () => mockUseMembershipState(),
}))
vi.mock('app/shared/experiments/outreachProGatingV2Flag', () => ({
  useOutreachProGatingV2Flag: (...args: unknown[]) => mockUseFlag(...args),
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
  it('renders nothing when the flag is off', () => {
    setup({ enabled: false, state: membership({ tier: 'free' }) })

    expect(screen.queryByRole('button')).toBeNull()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('renders nothing before the membership state is ready', () => {
    setup({ ready: false })

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('takes the flag exposure, since the banner is the treatment surface', () => {
    setup()

    expect(mockUseFlag).toHaveBeenCalledWith()
  })

  it('renders the upsell and opens the pitch dialog for a free campaign', async () => {
    const user = userEvent.setup()
    setup({ state: membership({ tier: 'free' }) })

    expect(
      screen.getByText(MEMBERSHIP_COPY.banner.free.body),
    ).toBeInTheDocument()
    expect(screen.getByText(MEMBERSHIP_COPY.banner.free.cta)).toBeVisible()
    expect(screen.getByText('pitch:false')).toBeInTheDocument()

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
    expect(screen.getByRole('button')).toBeDisabled()

    await user.click(screen.getByRole('button'))

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
