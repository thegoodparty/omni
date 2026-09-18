import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { BANNER_COPY, GATE_NOUN } from './gateCopy'
import type { OutreachGateState } from './useOutreachGate'
import { GateBanner } from './GateBanner'

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

describe('GateBanner', () => {
  it('renders nothing when requirement is null', () => {
    const { container } = render(
      <GateBanner
        channel="sms"
        state={stateWith({ requirement: null })}
        onOpenExplainer={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the two-step-free line for a free-tier texting channel', () => {
    render(
      <GateBanner
        channel="sms"
        state={stateWith({ requirement: 'pro', twoStep: true })}
        onOpenExplainer={vi.fn()}
      />,
    )

    expect(
      screen.getByText(BANNER_COPY.twoStepFree(GATE_NOUN.sms)),
    ).toBeInTheDocument()
  })

  it('shows the needs-verification line for a Pro texting channel', () => {
    render(
      <GateBanner
        channel="sms"
        state={stateWith({ requirement: 'verify', twoStep: true })}
        onOpenExplainer={vi.fn()}
      />,
    )

    expect(
      screen.getByText(BANNER_COPY.needsVerification(GATE_NOUN.sms)),
    ).toBeInTheDocument()
  })

  it('shows the in-review line', () => {
    render(
      <GateBanner
        channel="sms"
        state={stateWith({ requirement: 'in_review', twoStep: true })}
        onOpenExplainer={vi.fn()}
      />,
    )

    expect(screen.getByText(BANNER_COPY.inReview)).toBeInTheDocument()
  })

  it('shows the awaiting-PIN line', () => {
    render(
      <GateBanner
        channel="sms"
        state={stateWith({ requirement: 'pin', twoStep: true })}
        onOpenExplainer={vi.fn()}
      />,
    )

    expect(screen.getByText(BANNER_COPY.awaitingPin)).toBeInTheDocument()
  })

  it('shows the door-knocking line for a free-tier door channel', () => {
    render(
      <GateBanner
        channel="door"
        state={stateWith({ requirement: 'pro' })}
        onOpenExplainer={vi.fn()}
      />,
    )

    expect(screen.getByText(BANNER_COPY.door)).toBeInTheDocument()
  })

  it('shows the phone-bank line for a free-tier phone-bank channel', () => {
    render(
      <GateBanner
        channel="phone-bank"
        state={stateWith({ requirement: 'pro' })}
        onOpenExplainer={vi.fn()}
      />,
    )

    expect(screen.getByText(BANNER_COPY.phoneBank)).toBeInTheDocument()
  })

  it('shows the robocall line for a free-tier robocall channel', () => {
    render(
      <GateBanner
        channel="robocall"
        state={stateWith({ requirement: 'pro' })}
        onOpenExplainer={vi.fn()}
      />,
    )

    expect(screen.getByText(BANNER_COPY.robocall)).toBeInTheDocument()
  })

  it('opens the explainer when clicked', async () => {
    const user = userEvent.setup()
    const onOpenExplainer = vi.fn()
    render(
      <GateBanner
        channel="sms"
        state={stateWith({ requirement: 'pro', twoStep: true })}
        onOpenExplainer={onOpenExplainer}
      />,
    )

    await user.click(screen.getByRole('button'))

    expect(onOpenExplainer).toHaveBeenCalledTimes(1)
  })

  it('opens the explainer on Enter', async () => {
    const user = userEvent.setup()
    const onOpenExplainer = vi.fn()
    render(
      <GateBanner
        channel="sms"
        state={stateWith({ requirement: 'pro', twoStep: true })}
        onOpenExplainer={onOpenExplainer}
      />,
    )

    screen.getByRole('button').focus()
    await user.keyboard('{Enter}')

    expect(onOpenExplainer).toHaveBeenCalledTimes(1)
  })
})
