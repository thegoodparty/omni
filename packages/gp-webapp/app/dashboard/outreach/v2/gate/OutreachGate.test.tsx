import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { PRO_UPGRADE_STEP } from 'app/dashboard/pro-upgrade/proUpgradeStep'
import ProUpgradeFlow from 'app/dashboard/pro-upgrade/components/ProUpgradeFlow'
import CampaignVerificationSteps from 'app/dashboard/campaign-verification/components/CampaignVerificationSteps'
import { PinDialog } from 'app/dashboard/shared/membership/PinDialog'
import { BANNER_COPY, GATE_NOTICE_COPY, GATE_NOUN } from './gateCopy'
import type { OutreachGateState } from './useOutreachGate'
import { OutreachGate } from './OutreachGate'

vi.mock('app/dashboard/pro-upgrade/components/ProUpgradeFlow', () => ({
  default: vi.fn(() => null),
}))
vi.mock(
  'app/dashboard/campaign-verification/components/CampaignVerificationSteps',
  () => ({
    default: vi.fn(() => null),
  }),
)
vi.mock('app/dashboard/shared/membership/PinDialog', () => ({
  PinDialog: vi.fn(() => null),
}))

const mockProUpgradeFlow = vi.mocked(ProUpgradeFlow)
const mockCampaignVerificationSteps = vi.mocked(CampaignVerificationSteps)
const mockPinDialog = vi.mocked(PinDialog)

const stateWith = (
  overrides: Partial<OutreachGateState>,
): OutreachGateState => ({
  enabled: true,
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
        {...baseProps}
        state={stateWith({ requirement: 'pro' })}
        open={false}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when requirement is null', () => {
    const { container } = render(
      <OutreachGate {...baseProps} state={stateWith({ requirement: null })} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  describe('requirement: pro', () => {
    it('mounts ProUpgradeFlow on the interstitial step for the channel', () => {
      render(
        <OutreachGate
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

    it('captions a failed delete beside the Delete button', () => {
      render(
        <OutreachGate
          {...baseProps}
          state={stateWith({ requirement: 'pro' })}
          onDelete={vi.fn()}
          deleteError
        />,
      )

      expect(screen.getByText(GATE_NOTICE_COPY.deleteError)).toBeInTheDocument()
    })

    it('passes onExit straight through', async () => {
      const onExit = vi.fn()
      render(
        <OutreachGate
          {...baseProps}
          state={stateWith({ requirement: 'pro' })}
          onExit={onExit}
        />,
      )

      mockProUpgradeFlow.mock.calls[0]![0].onExit()

      expect(onExit).toHaveBeenCalledTimes(1)
    })

    it('shows a ghost destructive Delete when onDelete is given', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn()
      render(
        <OutreachGate
          {...baseProps}
          state={stateWith({ requirement: 'pro' })}
          onDelete={onDelete}
        />,
      )

      await user.click(screen.getByRole('button', { name: /delete/i }))

      expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('renders no Delete button when onDelete is omitted', () => {
      render(
        <OutreachGate
          {...baseProps}
          state={stateWith({ requirement: 'pro' })}
        />,
      )

      expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    })

    it('calls onComplete once Pro is done for a non-texting channel', () => {
      const onComplete = vi.fn()
      render(
        <OutreachGate
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
          {...baseProps}
          channel="sms"
          state={stateWith({ requirement: 'pro' })}
          onComplete={onComplete}
        />,
      )

      rerender(
        <OutreachGate
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
          {...baseProps}
          channel="sms"
          state={stateWith({ requirement: 'pro' })}
          onComplete={onComplete}
        />,
      )

      rerender(
        <OutreachGate
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
          {...baseProps}
          channel="robocall"
          state={stateWith({ requirement: 'pro', twoStep: false })}
          onComplete={onComplete}
        />,
      )

      rerender(
        <OutreachGate
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
      const onDelete = vi.fn()
      render(
        <OutreachGate
          {...baseProps}
          state={stateWith({ requirement: 'verify' })}
          onExit={onExit}
          onComplete={onComplete}
          onDelete={onDelete}
        />,
      )

      expect(mockCampaignVerificationSteps).toHaveBeenCalledWith(
        expect.objectContaining({
          onExit,
          onComplete,
          onDelete,
          completeLabel: GATE_NOTICE_COPY.backToNoun(GATE_NOUN.sms),
        }),
        undefined,
      )
    })
  })

  describe('requirement: pin', () => {
    it('mounts PinDialog open with tcrCompliance and no Delete button', () => {
      const tcrCompliance = { status: 'submitted', peerlyIdentityId: 'p-1' }
      render(
        <OutreachGate
          {...baseProps}
          state={stateWith({
            requirement: 'pin',
            // @ts-expect-error partial fixture, only status/peerlyIdentityId read
            tcrCompliance,
          })}
          onDelete={vi.fn()}
        />,
      )

      expect(mockPinDialog).toHaveBeenCalledWith(
        expect.objectContaining({ open: true, tcrCompliance }),
        undefined,
      )
      expect(screen.getByText(BANNER_COPY.awaitingPin)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    })

    // The PIN is the last thing standing between the candidate and their
    // text. Reading its success as a close dropped them out of the sheet at
    // the very end of the journey.
    it('completes the gate when the PIN verifies', () => {
      const onComplete = vi.fn()
      const onExit = vi.fn()
      render(
        <OutreachGate
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

    it('shows a ghost destructive Delete when onDelete is given', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn()
      render(
        <OutreachGate
          {...baseProps}
          state={stateWith({ requirement: 'in_review' })}
          onDelete={onDelete}
        />,
      )

      await user.click(screen.getByRole('button', { name: /delete/i }))

      expect(onDelete).toHaveBeenCalledTimes(1)
    })
  })
})
