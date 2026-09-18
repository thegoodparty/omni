import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
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

    it('does not call onComplete for texting once Pro is done but verification is still needed', () => {
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
              texting: 'needs_verification',
              pinDelivery: null,
              isElectedOffice: false,
            },
          })}
          onComplete={onComplete}
        />,
      )

      mockProUpgradeFlow.mock.calls[0]![0].onComplete()

      expect(onComplete).not.toHaveBeenCalled()
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

    // Models the real cross-task dependency named in OutreachGate.tsx's WHY
    // comment: ProUpgradeFlow's SuccessStep holds Continue disabled until
    // the shared campaign query cache reports isPro, and useMembershipState
    // derives `membership.tier` from that same cache — so by the time a
    // candidate can click through, the caller's useOutreachGate() has
    // already re-rendered this component with the post-upgrade `state`.
    // OutreachGate itself never switches screens on onComplete — it only
    // decides whether to forward the call; a caller's own next render
    // (requirement now 'verify') is what actually shows the next screen.
    it('does not call onComplete once Pro flips for texting still needing verification, and shows verification only once the caller advances requirement', () => {
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
            requirement: 'pro',
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

      expect(onComplete).not.toHaveBeenCalled()
      expect(mockCampaignVerificationSteps).not.toHaveBeenCalled()

      rerender(
        <OutreachGate
          {...baseProps}
          channel="sms"
          state={stateWith({
            requirement: 'verify',
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

      expect(mockCampaignVerificationSteps).toHaveBeenCalled()
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
