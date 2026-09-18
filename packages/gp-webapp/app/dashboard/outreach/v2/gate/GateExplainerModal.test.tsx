import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  EXPLAINER_COPY,
  GATE_CHANNEL_TITLE,
  GATE_NOUN,
  INTERSTITIAL_COPY,
  PRO_CHANNEL_WHY,
} from './gateCopy'
import type { OutreachGateState } from './useOutreachGate'
import { GateExplainerModal } from './GateExplainerModal'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const trackEventMock = vi.mocked(trackEvent)

const stateWith = (
  overrides: Partial<OutreachGateState>,
): OutreachGateState => ({
  enabled: true,
  requirement: null,
  twoStep: false,
  membership: null,
  tcrCompliance: null,
  ...overrides,
})

const noop = {
  onOpenChange: vi.fn(),
  onUpgrade: vi.fn(),
  onVerify: vi.fn(),
  onPin: vi.fn(),
}

describe('GateExplainerModal', () => {
  beforeEach(() => {
    trackEventMock.mockClear()
  })

  it('renders nothing when requirement is null', () => {
    render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: null })}
        open
        {...noop}
      />,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the two-step title/body, the Pro badge, the channel block, and both step cards for a free texting channel', () => {
    render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'pro', twoStep: true })}
        open
        {...noop}
      />,
    )

    expect(
      screen.getByText(EXPLAINER_COPY.titleTwoStep(GATE_NOUN.sms)),
    ).toBeInTheDocument()
    expect(
      screen.getByText(EXPLAINER_COPY.bodyTwoStep(GATE_NOUN.sms)),
    ).toBeInTheDocument()
    expect(screen.getByText(GATE_CHANNEL_TITLE.sms)).toBeInTheDocument()
    expect(screen.getByText(PRO_CHANNEL_WHY.sms)).toBeInTheDocument()
    // "Upgrade to Pro" is both the step card's title and the CTA button's
    // label, so two matches is the correct count here.
    expect(screen.getAllByText(INTERSTITIAL_COPY.proStep.title)).toHaveLength(2)
    expect(
      screen.getByText(INTERSTITIAL_COPY.verifyStep.title),
    ).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText(INTERSTITIAL_COPY.proStep.pill)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: EXPLAINER_COPY.ctaUpgrade }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: EXPLAINER_COPY.dismissFree }),
    ).toBeInTheDocument()
  })

  it('shows the one-step title/body and a single, unnumbered, pill-less card for a free non-texting channel', () => {
    render(
      <GateExplainerModal
        channel="robocall"
        state={stateWith({ requirement: 'pro', twoStep: false })}
        open
        {...noop}
      />,
    )

    expect(
      screen.getByText(EXPLAINER_COPY.titleOneStep(GATE_NOUN.robocall)),
    ).toBeInTheDocument()
    expect(screen.getByText(EXPLAINER_COPY.bodyOneStep)).toBeInTheDocument()
    expect(
      screen.queryByText(INTERSTITIAL_COPY.verifyStep.title),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(
      screen.queryByText(INTERSTITIAL_COPY.proStep.pill),
    ).not.toBeInTheDocument()
  })

  it('shows the verify-only title/body and an unnumbered verification card for an already-Pro texting channel', () => {
    render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'verify', twoStep: true })}
        open
        {...noop}
      />,
    )

    expect(
      screen.getByText(EXPLAINER_COPY.titleVerifyOnly(GATE_NOUN.sms)),
    ).toBeInTheDocument()
    expect(
      screen.getByText(EXPLAINER_COPY.bodyVerifyOnly(GATE_NOUN.sms)),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(INTERSTITIAL_COPY.proStep.title),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('2')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: EXPLAINER_COPY.ctaVerify }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: EXPLAINER_COPY.dismissPro }),
    ).toBeInTheDocument()
  })

  it('shows the PIN CTA when awaiting a PIN', () => {
    render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'pin', twoStep: true })}
        open
        {...noop}
      />,
    )

    expect(
      screen.getByRole('button', { name: EXPLAINER_COPY.ctaPin }),
    ).toBeInTheDocument()
  })

  it('shows no action CTA while in review, only dismiss', () => {
    render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'in_review', twoStep: true })}
        open
        {...noop}
      />,
    )

    expect(
      screen.queryByRole('button', { name: EXPLAINER_COPY.ctaUpgrade }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: EXPLAINER_COPY.ctaVerify }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: EXPLAINER_COPY.ctaPin }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: EXPLAINER_COPY.dismissPro }),
    ).toBeInTheDocument()
  })

  it('closes then calls onUpgrade when the upgrade CTA is clicked', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onUpgrade = vi.fn()
    render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'pro', twoStep: true })}
        open
        onOpenChange={onOpenChange}
        onUpgrade={onUpgrade}
        onVerify={vi.fn()}
        onPin={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: EXPLAINER_COPY.ctaUpgrade }),
    )

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onUpgrade).toHaveBeenCalledTimes(1)
  })

  it('closes without calling any action CTA when dismissed', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onUpgrade = vi.fn()
    render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'pro', twoStep: true })}
        open
        onOpenChange={onOpenChange}
        onUpgrade={onUpgrade}
        onVerify={vi.fn()}
        onPin={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: EXPLAINER_COPY.dismissFree }),
    )

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onUpgrade).not.toHaveBeenCalled()
  })

  it('fires one explainer view per open, and none while closed', () => {
    const { rerender } = render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'verify', twoStep: true })}
        open={false}
        {...noop}
      />,
    )

    expect(trackEventMock).not.toHaveBeenCalledWith(
      EVENTS.Outreach.Gate.ExplainerViewed,
      expect.anything(),
    )

    rerender(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'verify', twoStep: true })}
        open
        {...noop}
      />,
    )
    rerender(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'verify', twoStep: true })}
        open
        {...noop}
      />,
    )

    const views = trackEventMock.mock.calls.filter(
      ([name]) => name === EVENTS.Outreach.Gate.ExplainerViewed,
    )
    expect(views).toHaveLength(1)
    expect(views[0]?.[1]).toMatchObject({
      channel: 'sms',
      requirement: 'verify',
    })
  })

  it('reports which CTA was pressed', async () => {
    const user = userEvent.setup()
    render(
      <GateExplainerModal
        channel="robocall"
        state={stateWith({ requirement: 'pro' })}
        open
        {...noop}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: EXPLAINER_COPY.ctaUpgrade }),
    )

    expect(trackEventMock).toHaveBeenCalledWith(
      EVENTS.Outreach.Gate.ExplainerCta,
      { channel: 'robocall', requirement: 'pro', cta: 'upgrade' },
    )
  })

  it('reports a dismiss as its own CTA', async () => {
    const user = userEvent.setup()
    render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'in_review', twoStep: true })}
        open
        {...noop}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: EXPLAINER_COPY.dismissPro }),
    )

    expect(trackEventMock).toHaveBeenCalledWith(
      EVENTS.Outreach.Gate.ExplainerCta,
      { channel: 'sms', requirement: 'in_review', cta: 'dismiss' },
    )
  })
})
