import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { PLAN_PRICING } from '@goodparty_org/contracts'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import type { Campaign } from 'helpers/types'
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

const planFlag = vi.hoisted(() => ({ enabled: false }))
vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({
    ready: true,
    enabled: planFlag.enabled,
  }),
}))

const stateWith = (
  overrides: Partial<OutreachGateState>,
): OutreachGateState => ({
  enabled: true,
  resolved: true,
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
    planFlag.enabled = false
    trackEventMock.mockClear()
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      configurable: true,
      writable: true,
    })
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

    expect(
      screen.getByText('Join Pro to send this campaign'),
    ).toBeInTheDocument()
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
  // dialog left-aligns its wrapped lines and stacks its buttons. The footer
  // also has to sit OUTSIDE the scrolling body, or expanding the verification
  // card scrolls the CTA off the bottom of a short viewport.
  it('centers the header, rows the footer on desktop, and pins it outside the scrolling body', () => {
    render(
      <GateExplainerModal
        channel="sms"
        state={stateWith({ requirement: 'verify', twoStep: true })}
        open
        {...noop}
      />,
    )

    const content = document.querySelector('[data-slot="dialog-content"]')
    const footer = document.querySelector('[data-slot="dialog-footer"]')

    expect(document.querySelector('[data-slot="dialog-header"]')).toHaveClass(
      'sm:text-center',
    )
    expect(footer).toHaveClass('sm:flex-row-reverse', 'shrink-0')
    expect(content).toHaveClass('flex-col')
    expect(content?.querySelector('.overflow-y-auto')).not.toContainElement(
      footer as HTMLElement,
    )
  })

  it('pitches Pro, never Team, on a race over the Team threshold', () => {
    planFlag.enabled = true
    render(
      <CampaignContext.Provider
        value={[
          {
            raceTargetMetrics: {
              registeredVoters: PLAN_PRICING.teamRecommendVoterThreshold + 1,
            },
          } as unknown as Campaign,
        ]}
      >
        <GateExplainerModal
          channel="sms"
          state={stateWith({ requirement: 'pro', twoStep: false })}
          open
          {...noop}
        />
      </CampaignContext.Provider>,
    )

    expect(
      screen.getByText('Join Pro to send this campaign'),
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Team|\$399/)
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

    expect(
      screen.getByText('Join Pro to send this campaign'),
    ).toBeInTheDocument()
    expect(screen.getByText(PRO_COPY.robocall.headline)).toBeInTheDocument()
    expect(screen.queryByText(PITCH_PANEL_COPY.verifyTitle)).toBeNull()
  })

  it('names what Pro unlocks for the two list channels', () => {
    const { unmount } = render(
      <GateExplainerModal
        channel="phone-bank"
        state={stateWith({ requirement: 'pro', twoStep: false })}
        open
        {...noop}
      />,
    )
    expect(screen.getByText('Join Pro to call this list')).toBeInTheDocument()
    expect(
      screen.getByText(PRO_COPY['phone-bank'].headline),
    ).toBeInTheDocument()
    unmount()

    render(
      <GateExplainerModal
        channel="door"
        state={stateWith({ requirement: 'pro', twoStep: false })}
        open
        {...noop}
      />,
    )
    expect(screen.getByText('Join Pro to start knocking')).toBeInTheDocument()
    expect(screen.getByText(PRO_COPY.door.headline)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join Pro' })).toBeInTheDocument()
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

  describe('with per-campaign pricing on', () => {
    beforeEach(() => {
      planFlag.enabled = true
    })

    it.each(['sms', 'robocall', 'door', 'phone-bank'] as const)(
      'stacks a priced Join Pro over a ghost See all plans for %s, with no Later',
      (channel) => {
        render(
          <GateExplainerModal
            channel={channel}
            state={stateWith({ requirement: 'pro' })}
            open
            {...noop}
          />,
        )

        expect(
          screen.getByRole('button', { name: 'Join Pro for $299' }),
        ).toBeInTheDocument()
        expect(
          screen.getByRole('link', { name: 'See all plans' }),
        ).toHaveAttribute('href', '/dashboard/plans')
        expect(
          screen.queryByRole('button', { name: EXPLAINER_COPY.dismissPro }),
        ).toBeNull()
        expect(screen.queryByText('Maybe later')).toBeNull()
        const footer = document.querySelector('[data-slot="dialog-footer"]')
        expect(footer).toHaveClass('flex-col', 'sm:flex-col')
      },
    )

    it('draws four rows with the Bonus pill', () => {
      render(
        <GateExplainerModal
          channel="sms"
          state={stateWith({ requirement: 'pro', twoStep: true })}
          open
          {...noop}
        />,
      )

      expect(
        screen.getByText(
          'Pay $299 once for your plan, good for your whole race',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByText('$175 outreach credit to get started'),
      ).toBeInTheDocument()
      expect(screen.getByText('Bonus')).toBeInTheDocument()
      expect(screen.getByText(PITCH_PANEL_COPY.verifyTitle)).toBeInTheDocument()
      expect(screen.queryByText(PITCH_PANEL_COPY.verifyBody)).toBeNull()
    })

    it('closes then calls onUpgrade from the priced button, and reports it', async () => {
      const user = userEvent.setup()
      const onUpgrade = vi.fn()
      const onOpenChange = vi.fn()
      render(
        <GateExplainerModal
          channel="door"
          state={stateWith({ requirement: 'pro' })}
          open
          {...noop}
          onUpgrade={onUpgrade}
          onOpenChange={onOpenChange}
        />,
      )

      await user.click(
        screen.getByRole('button', { name: 'Join Pro for $299' }),
      )

      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(onUpgrade).toHaveBeenCalledTimes(1)
      expect(trackEventMock).toHaveBeenCalledWith(
        EVENTS.Outreach.Gate.ExplainerCta,
        { channel: 'door', requirement: 'pro', cta: 'upgrade' },
      )
    })

    it('dismisses with the X and reports it', async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(
        <GateExplainerModal
          channel="sms"
          state={stateWith({ requirement: 'pro' })}
          open
          {...noop}
          onOpenChange={onOpenChange}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Close' }))

      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(trackEventMock).toHaveBeenCalledWith(
        EVENTS.Outreach.Gate.ExplainerCta,
        { channel: 'sms', requirement: 'pro', cta: 'dismiss' },
      )
    })

    it('keeps the verify explainer on the same dialog, with Later under its CTA', async () => {
      const user = userEvent.setup()
      const onVerify = vi.fn()
      render(
        <GateExplainerModal
          channel="sms"
          state={stateWith({ requirement: 'verify', twoStep: true })}
          open
          {...noop}
          onVerify={onVerify}
        />,
      )

      expect(
        screen.getByText('One more step before this text can send'),
      ).toBeInTheDocument()
      expect(screen.getByText(PITCH_PANEL_COPY.verifyBody)).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: EXPLAINER_COPY.dismissPro }),
      ).toBeInTheDocument()

      await user.click(
        screen.getByRole('button', { name: EXPLAINER_COPY.ctaVerify }),
      )

      expect(onVerify).toHaveBeenCalledTimes(1)
    })

    it('is a drawer on a phone', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: 390,
        configurable: true,
        writable: true,
      })
      render(
        <GateExplainerModal
          channel="sms"
          state={stateWith({ requirement: 'pro' })}
          open
          {...noop}
        />,
      )

      expect(
        await screen.findByRole('dialog', {
          name: 'Join Pro to send this campaign',
        }),
      ).toHaveAttribute('data-slot', 'drawer-content')
      expect(
        screen.getByRole('button', { name: 'Join Pro for $299' }),
      ).toBeInTheDocument()
    })
  })
})
