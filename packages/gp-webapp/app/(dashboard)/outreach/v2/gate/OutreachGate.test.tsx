import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { PRO_UPGRADE_STEP } from 'app/(dashboard)/pro-upgrade/proUpgradeStep'
import ProUpgradeFlow from 'app/(dashboard)/pro-upgrade/components/ProUpgradeFlow'
import CampaignVerificationSteps from 'app/(dashboard)/campaign-verification/components/CampaignVerificationSteps'
import { PinDialog } from 'app/(dashboard)/shared/membership/PinDialog'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { BANNER_COPY, GATE_NOTICE_COPY, GATE_NOUN } from './gateCopy'
import type { OutreachGateState } from './useOutreachGate'
import { OutreachGate } from './OutreachGate'

vi.mock('app/(dashboard)/pro-upgrade/components/ProUpgradeFlow', () => ({
  default: vi.fn(() => null),
}))
vi.mock(
  'app/(dashboard)/campaign-verification/components/CampaignVerificationSteps',
  () => ({
    default: vi.fn(() => null),
  }),
)
vi.mock('app/(dashboard)/shared/membership/PinDialog', () => ({
  PinDialog: vi.fn(() => null),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const mockProUpgradeFlow = vi.mocked(ProUpgradeFlow)
const mockCampaignVerificationSteps = vi.mocked(CampaignVerificationSteps)
const mockPinDialog = vi.mocked(PinDialog)

const stateWith = (
  overrides: Partial<OutreachGateState>,
): OutreachGateState => ({
  enabled: true,
  resolved: true,
  requirement: null,
  twoStep: true,
  membership: {
    tier: 'free',
    texting: 'needs_verification',
    pinDelivery: null,
    isElectedOffice: false,
  },
  tcrCompliance: null,
  ...overrides,
})

const baseProps = {
  channel: 'sms' as const,
  open: true,
  onExit: vi.fn(),
  onComplete: vi.fn(),
}

describe('OutreachGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <OutreachGate
        source="outreach_page"
        {...baseProps}
        state={stateWith({ requirement: 'pro' })}
        open={false}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when requirement is null', () => {
    const { container } = render(
      <OutreachGate
        source="outreach_page"
        {...baseProps}
        state={stateWith({ requirement: null })}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  describe('requirement: pro', () => {
    it('mounts ProUpgradeFlow on the interstitial step for the channel', () => {
      render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          state={stateWith({ requirement: 'pro' })}
        />,
      )

      expect(mockProUpgradeFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          initialStep: PRO_UPGRADE_STEP.INTERSTITIAL,
          channel: 'sms',
        }),
        undefined,
      )
    })

    // Only the save that just wrote the draft shows the pitch; a resume or
    // the explainer's Join Pro opens on the wizard's first step instead.
    it('starts on guidance when the caller skips the interstitial', () => {
      render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          state={stateWith({ requirement: 'pro' })}
          showInterstitial={false}
        />,
      )

      expect(mockProUpgradeFlow).toHaveBeenCalledWith(
        expect.objectContaining({ initialStep: PRO_UPGRADE_STEP.GUIDANCE }),
        undefined,
      )
    })

    it('passes onExit straight through', async () => {
      const onExit = vi.fn()
      render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          state={stateWith({ requirement: 'pro' })}
          onExit={onExit}
        />,
      )

      mockProUpgradeFlow.mock.calls[0]![0].onExit()

      expect(onExit).toHaveBeenCalledTimes(1)
    })

    it('calls onComplete once Pro is done for a non-texting channel', () => {
      const onComplete = vi.fn()
      render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          channel="robocall"
          state={stateWith({ requirement: 'pro', twoStep: false })}
          onComplete={onComplete}
        />,
      )

      mockProUpgradeFlow.mock.calls[0]![0].onComplete()

      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('calls onComplete for texting once Pro is done and texting is already cleared', () => {
      const onComplete = vi.fn()
      render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          channel="sms"
          state={stateWith({
            requirement: 'pro',
            twoStep: true,
            membership: {
              tier: 'pro',
              texting: 'cleared',
              pinDelivery: null,
              isElectedOffice: false,
            },
          })}
          onComplete={onComplete}
        />,
      )

      mockProUpgradeFlow.mock.calls[0]![0].onComplete()

      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    // Models the real race: ProUpgradeFlow's SuccessStep polls the same
    // campaign cache useOutreachGate reads, so the requirement moves while
    // the candidate is still looking at the success screen. The screen is
    // latched, so a requirement change alone must not move it — only the
    // completion the candidate actually presses does.
    it('for texting, switches to verification only when ProUpgradeFlow completes after the requirement has moved', () => {
      const onComplete = vi.fn()
      const proMembership = {
        tier: 'pro' as const,
        texting: 'needs_verification' as const,
        pinDelivery: null,
        isElectedOffice: false,
      }
      const { rerender } = render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          channel="sms"
          state={stateWith({ requirement: 'pro' })}
          onComplete={onComplete}
        />,
      )

      rerender(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          channel="sms"
          state={stateWith({
            requirement: 'verify',
            membership: proMembership,
          })}
          onComplete={onComplete}
        />,
      )

      // Still on the upgrade's own success screen — the candidate has not
      // pressed anything yet.
      expect(mockCampaignVerificationSteps).not.toHaveBeenCalled()

      const latestCall =
        mockProUpgradeFlow.mock.calls[mockProUpgradeFlow.mock.calls.length - 1]!
      act(() => latestCall[0].onComplete())

      expect(onComplete).not.toHaveBeenCalled()
      expect(mockCampaignVerificationSteps).toHaveBeenCalled()
    })

    // The bug this latch exists for: the requirement clearing used to unmount
    // the success screen mid-upgrade, so the Continue that fires onComplete
    // was never reachable.
    it('keeps the success screen up when the requirement clears mid-upgrade, and completes on its Continue', () => {
      const onComplete = vi.fn()
      const { rerender } = render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          channel="sms"
          state={stateWith({ requirement: 'pro' })}
          onComplete={onComplete}
        />,
      )

      rerender(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          channel="sms"
          state={stateWith({
            requirement: null,
            membership: {
              tier: 'pro',
              texting: 'cleared',
              pinDelivery: null,
              isElectedOffice: false,
            },
          })}
          onComplete={onComplete}
        />,
      )

      expect(mockProUpgradeFlow).toHaveBeenCalled()
      const latestCall =
        mockProUpgradeFlow.mock.calls[mockProUpgradeFlow.mock.calls.length - 1]!
      act(() => latestCall[0].onComplete())

      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('calls onComplete once Pro flips for a non-texting channel, without waiting on a requirement change', () => {
      const onComplete = vi.fn()
      const { rerender } = render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          channel="robocall"
          state={stateWith({ requirement: 'pro', twoStep: false })}
          onComplete={onComplete}
        />,
      )

      rerender(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          channel="robocall"
          state={stateWith({
            requirement: 'pro',
            twoStep: false,
            membership: {
              tier: 'pro',
              texting: 'needs_verification',
              pinDelivery: null,
              isElectedOffice: false,
            },
          })}
          onComplete={onComplete}
        />,
      )

      const latestCall =
        mockProUpgradeFlow.mock.calls[mockProUpgradeFlow.mock.calls.length - 1]!
      latestCall[0].onComplete()

      expect(onComplete).toHaveBeenCalledTimes(1)
    })
  })

  describe('requirement: verify', () => {
    it('mounts CampaignVerificationSteps with the channel noun in completeLabel', () => {
      const onExit = vi.fn()
      const onComplete = vi.fn()
      render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          state={stateWith({ requirement: 'verify' })}
          onExit={onExit}
          onComplete={onComplete}
        />,
      )

      expect(mockCampaignVerificationSteps).toHaveBeenCalledWith(
        expect.objectContaining({
          onExit,
          onComplete,
          completeLabel: GATE_NOTICE_COPY.backToNoun(GATE_NOUN.sms),
        }),
        undefined,
      )
    })
  })

  describe('requirement: pin', () => {
    it('mounts PinDialog open with tcrCompliance', () => {
      const tcrCompliance = { status: 'submitted', peerlyIdentityId: 'p-1' }
      render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          state={stateWith({
            requirement: 'pin',
            // @ts-expect-error partial fixture, only status/peerlyIdentityId read
            tcrCompliance,
          })}
        />,
      )

      expect(mockPinDialog).toHaveBeenCalledWith(
        expect.objectContaining({ open: true, tcrCompliance }),
        undefined,
      )
      expect(screen.getByText(BANNER_COPY.awaitingPin)).toBeInTheDocument()
    })

    // The PIN is the last thing standing between the candidate and their
    // text. Reading its success as a close dropped them out of the sheet at
    // the very end of the journey.
    it('completes the gate when the PIN verifies', () => {
      const onComplete = vi.fn()
      const onExit = vi.fn()
      render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          state={stateWith({ requirement: 'pin' })}
          onComplete={onComplete}
          onExit={onExit}
        />,
      )

      mockPinDialog.mock.calls[0]![0].onSuccess?.()

      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(onExit).not.toHaveBeenCalled()
    })

    it('exits when PinDialog closes', () => {
      const onExit = vi.fn()
      render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          state={stateWith({ requirement: 'pin' })}
          onExit={onExit}
        />,
      )

      mockPinDialog.mock.calls[0]![0].onOpenChange(false)

      expect(onExit).toHaveBeenCalledTimes(1)
    })

    it('does not exit when PinDialog reports open', () => {
      const onExit = vi.fn()
      render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          state={stateWith({ requirement: 'pin' })}
          onExit={onExit}
        />,
      )

      mockPinDialog.mock.calls[0]![0].onOpenChange(true)

      expect(onExit).not.toHaveBeenCalled()
    })
  })

  describe('requirement: in_review', () => {
    it('shows the in-review notice and a Back to my {noun} exit button', async () => {
      const user = userEvent.setup()
      const onExit = vi.fn()
      render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          state={stateWith({ requirement: 'in_review' })}
          onExit={onExit}
        />,
      )

      expect(screen.getByText(BANNER_COPY.inReview)).toBeInTheDocument()
      expect(
        screen.getByText(GATE_NOTICE_COPY.inReviewSavedLine(GATE_NOUN.sms)),
      ).toBeInTheDocument()

      await user.click(
        screen.getByRole('button', {
          name: GATE_NOTICE_COPY.backToNoun(GATE_NOUN.sms),
        }),
      )

      expect(onExit).toHaveBeenCalledTimes(1)
    })

    it('fires In Review Viewed once with the channel', () => {
      render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          state={stateWith({ requirement: 'in_review' })}
        />,
      )

      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.Outreach.Gate.InReviewViewed,
        { channel: 'sms' },
      )
      expect(trackEvent).toHaveBeenCalledTimes(1)
    })

    it('does not fire In Review Viewed on the PIN screen', () => {
      render(
        <OutreachGate
          source="outreach_page"
          {...baseProps}
          state={stateWith({ requirement: 'pin' })}
        />,
      )

      expect(trackEvent).not.toHaveBeenCalledWith(
        EVENTS.Outreach.Gate.InReviewViewed,
        expect.anything(),
      )
    })
  })
})

describe('OutreachGate attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hands the wizard the source, channel, CTA and tracker task', () => {
    render(
      <OutreachGate
        {...baseProps}
        state={stateWith({ requirement: 'pro' })}
        source="campaign_manager"
        cta="Continue"
        tracker={{ trackerTaskId: 'task-1', phase: 'launch' }}
      />,
    )

    expect(mockProUpgradeFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        attribution: {
          source: 'campaign_manager',
          channel: 'sms',
          cta: 'Continue',
          trackerTaskId: 'task-1',
          phase: 'launch',
        },
      }),
      undefined,
    )
  })

  it('leaves out the CTA and task when there are none', () => {
    render(
      <OutreachGate
        {...baseProps}
        state={stateWith({ requirement: 'pro' })}
        source="outreach_page"
      />,
    )

    expect(mockProUpgradeFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        attribution: { source: 'outreach_page', channel: 'sms' },
      }),
      undefined,
    )
  })
})
