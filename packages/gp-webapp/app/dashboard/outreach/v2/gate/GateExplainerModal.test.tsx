import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  EXPLAINER_COPY,
  GATE_NOUN,
  PITCH_PANEL_COPY,
  PRO_COPY,
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

  it('shows the join title, the texting value card and the collapsed verification card for a free texting channel', () => {
    render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'pro', twoStep: true })}
        open
        {...noop}
      />,
    )

    expect(screen.getByText(EXPLAINER_COPY.titleFree)).toBeInTheDocument()
    expect(screen.getByText(PRO_COPY.sms.headline)).toBeInTheDocument()
    PRO_COPY.sms.bullets.forEach((bullet) => {
      expect(screen.getByText(bullet)).toBeInTheDocument()
    })
    expect(screen.getByText(PITCH_PANEL_COPY.verifyTitle)).toBeInTheDocument()
    expect(screen.queryByText(PITCH_PANEL_COPY.verifyBody)).toBeNull()
    expect(
      screen.getByRole('button', { name: EXPLAINER_COPY.ctaJoin }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: EXPLAINER_COPY.dismissPro }),
    ).toBeNull()
  })

  // DialogHeader's own classes end in `sm:text-left` and DialogFooter's in
  // `sm:flex-row`, so both need the sm: breakpoint restated or the desktop
  // dialog left-aligns its wrapped lines and stacks its buttons.
  it('centers the header and lays the footer out as a row on desktop', () => {
    render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'verify', twoStep: true })}
        open
        {...noop}
      />,
    )

    expect(document.querySelector('[data-slot="dialog-header"]')).toHaveClass(
      'sm:text-center',
    )
    expect(document.querySelector('[data-slot="dialog-footer"]')).toHaveClass(
      'sm:flex-row-reverse',
    )
  })

  it('shows the channel value card and no verification card for a free non-texting channel', () => {
    render(
      <GateExplainerModal
        channel="robocall"
        state={stateWith({ requirement: 'pro', twoStep: false })}
        open
        {...noop}
      />,
    )

    expect(screen.getByText(EXPLAINER_COPY.titleFree)).toBeInTheDocument()
    expect(screen.getByText(PRO_COPY.robocall.headline)).toBeInTheDocument()
    expect(screen.queryByText(PITCH_PANEL_COPY.verifyTitle)).toBeNull()
  })

  it('shows the verify title, body and an open verification card for an already-Pro texting channel', () => {
    render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'verify', twoStep: true })}
        open
        {...noop}
      />,
    )

    expect(
      screen.getByText(EXPLAINER_COPY.titleVerify(GATE_NOUN.sms)),
    ).toBeInTheDocument()
    expect(
      screen.getByText(EXPLAINER_COPY.bodyVerify(GATE_NOUN.sms)),
    ).toBeInTheDocument()
    expect(screen.queryByText(PRO_COPY.sms.headline)).toBeNull()
    expect(screen.getByText(PITCH_PANEL_COPY.verifyBody)).toBeInTheDocument()
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
      screen.getByText(EXPLAINER_COPY.titleVerify(GATE_NOUN.sms)),
    ).toBeInTheDocument()
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

    expect(screen.getByText(EXPLAINER_COPY.titleInReview)).toBeInTheDocument()
    expect(screen.getByText(EXPLAINER_COPY.bodyInReview)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: EXPLAINER_COPY.ctaJoin }),
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

  it('closes then calls onUpgrade when the join CTA is clicked', async () => {
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
      screen.getByRole('button', { name: EXPLAINER_COPY.ctaJoin }),
    )

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onUpgrade).toHaveBeenCalledTimes(1)
  })

  it('closes without calling any action CTA when dismissed', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onVerify = vi.fn()
    render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'verify', twoStep: true })}
        open
        onOpenChange={onOpenChange}
        onUpgrade={vi.fn()}
        onVerify={onVerify}
        onPin={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: EXPLAINER_COPY.dismissPro }),
    )

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onVerify).not.toHaveBeenCalled()
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
      screen.getByRole('button', { name: EXPLAINER_COPY.ctaJoin }),
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
