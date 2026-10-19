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
  state?: MembershipState | null
} = {}) => {
  mockUseMembershipState.mockReturnValue({
    ready,
    state: ready ? state : null,
    tcrCompliance: ready ? { status: 'submitted' } : null,
  })
  return render(<MembershipBanner />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSmsCompliance.current = {
    smsCompliance: 'open',
    smsCutoffDate: null,
    generalElectionDate: null,
  }
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

  it('has no action for closed texting, and still pitches Pro to a free campaign', () => {
    expect(resolveMembershipAction(membership({ texting: 'closed' }))).toBe(
      null,
    )
    expect(
      resolveMembershipAction(membership({ tier: 'free', texting: 'closed' })),
    ).toBe('pitch')
  })
})

describe('MembershipBanner', () => {
  it('renders nothing before the membership state is ready', () => {
    setup({ ready: false })

    expect(screen.queryByRole('button')).toBeNull()
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
      { path: '/' },
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
      EVENTS.ProUpgrade.Membership.VerificationBannerClicked,
      { path: '/' },
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
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Membership.PinBannerClicked,
      { path: '/' },
    )
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

  it('counts down to the cutoff while the window is closing', () => {
    mockSmsCompliance.current = {
      smsCompliance: 'closing',
      smsCutoffDate: '2026-10-15',
      generalElectionDate: '2026-11-03',
    }
    setup({ state: membership({ texting: 'needs_verification' }) })

    expect(
      screen.getByText('Get verified to send SMS by Oct. 15'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveTextContent('Start verification')
  })

  it('renders nothing, and fires nothing, once texting is closed for a Pro campaign', () => {
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

  it('still pitches Pro to a free campaign once texting is closed', () => {
    mockSmsCompliance.current = {
      smsCompliance: 'closed',
      smsCutoffDate: '2026-10-15',
      generalElectionDate: '2026-11-03',
    }
    setup({ state: membership({ tier: 'free', texting: 'closed' }) })

    expect(
      screen.getByText(MEMBERSHIP_COPY.banner.free.body),
    ).toBeInTheDocument()
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

  // The banner sits on every dashboard page, so a view would only restate
  // page views. Only the press is an event.
  it('fires no event just for rendering', () => {
    setup({ state: membership({ texting: 'awaiting_pin' }) })

    expect(trackEvent).not.toHaveBeenCalled()
  })

  // Belt-and-braces: verify MembershipBanner renders the expected UI for each
  // test-mode tenDlc preset, using the texting state that deriveMembershipState
  // derives from the API's output for each preset.
  describe('tenDlc preset banner rendering', () => {
    it('renders awaiting_pin banner for awaiting_pin preset (sentinel peerlyIdentityId)', () => {
      // awaiting_pin: submitted + peerlyIdentityId=sentinel + cvStatus=APPROVED
      // deriveMembershipState returns texting='awaiting_pin'
      setup({ state: membership({ texting: 'awaiting_pin' }) })

      expect(
        screen.getByText(MEMBERSHIP_COPY.banner.awaitingPin.body),
      ).toBeInTheDocument()
    })

    it('renders in-review banner for in_progress, filing_hold, and in_review presets', () => {
      // All three produce texting='in_review' via different API fields.
      setup({ state: membership({ texting: 'in_review' }) })

      expect(
        screen.getByText(MEMBERSHIP_COPY.banner.inReview.body),
      ).toBeInTheDocument()
    })

    it('renders nothing for the approved preset (texting=cleared, Pro campaign)', () => {
      setup({ state: membership({ texting: 'cleared' }) })

      expect(screen.queryByRole('button')).toBeNull()
    })

    it('renders the verification banner for rejected and error presets (needs_verification)', () => {
      setup({ state: membership({ texting: 'needs_verification' }) })

      expect(
        screen.getByText(MEMBERSHIP_COPY.banner.needsVerification.body),
      ).toBeInTheDocument()
    })
  })
})
