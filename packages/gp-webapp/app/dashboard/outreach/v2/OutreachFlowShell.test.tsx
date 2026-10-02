import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { OutreachFlowShell } from './OutreachFlowShell'
import { useLockedAtOpen } from './gate/useLockedAtOpen'
import type { OutreachGateState } from './gate/useOutreachGate'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const baseProps = {
  open: true,
  onClose: vi.fn(),
  title: 'Test flow',
  currentStep: 1,
  totalSteps: 1,
  dirty: false,
}

describe('OutreachFlowShell banner slot', () => {
  it('renders the banner above the CTA row', () => {
    render(
      <OutreachFlowShell
        {...baseProps}
        banner={<div>Gate banner</div>}
        cta={{ label: 'Continue', onClick: vi.fn() }}
      >
        Body
      </OutreachFlowShell>,
    )

    const banner = screen.getByText('Gate banner')
    const cta = screen.getByRole('button', { name: 'Continue' })
    // DOM order: banner precedes the CTA row's button.
    expect(
      banner.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('still renders the footer for a banner with no cta and no onBack', () => {
    render(
      <OutreachFlowShell
        {...baseProps}
        cta={null}
        banner={<div>Gate banner</div>}
      >
        Body
      </OutreachFlowShell>,
    )

    expect(screen.getByText('Gate banner')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('renders no footer at all when there is no cta, onBack, or banner', () => {
    render(
      <OutreachFlowShell {...baseProps} cta={null}>
        Body
      </OutreachFlowShell>,
    )

    expect(screen.queryByText('Gate banner')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(document.querySelector('[data-slot="drawer-footer"]')).toBeNull()
  })

  // A React element is truthy even when it renders null (an ungated
  // GateBanner returns null), so this must hold for an EXPLICIT
  // banner={undefined} — not just an omitted prop — to prove showFooter
  // isn't fooled by a caller passing a banner element through unconditionally.
  it('renders no footer at all for an explicit banner={undefined} with no cta and no onBack', () => {
    render(
      <OutreachFlowShell {...baseProps} cta={null} banner={undefined}>
        Body
      </OutreachFlowShell>,
    )

    expect(document.querySelector('[data-slot="drawer-footer"]')).toBeNull()
  })
})

describe('OutreachFlowShell header note', () => {
  it('renders the note under the stepper, inside the header', () => {
    render(
      <OutreachFlowShell
        {...baseProps}
        totalSteps={3}
        headerNote={<p>Training line</p>}
        cta={null}
      >
        Body
      </OutreachFlowShell>,
    )

    const note = screen.getByText('Training line')
    const progress = screen.getByRole('progressbar', { name: 'Progress' })
    expect(note.closest('[data-slot="drawer-header"]')).not.toBeNull()
    expect(
      progress.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('hides the note with the rest of the header on the success screen', () => {
    render(
      <OutreachFlowShell
        {...baseProps}
        totalSteps={0}
        headerNote={<p>Training line</p>}
        cta={null}
      >
        Body
      </OutreachFlowShell>,
    )

    expect(screen.queryByText('Training line')).toBeNull()
  })
})

describe('OutreachFlowShell stage tracking', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear()
  })

  const renderAt = (
    step: number,
    id: string,
    channel: 'sms' | 'social' = 'sms',
  ) =>
    render(
      <OutreachFlowShell
        {...baseProps}
        channel={channel}
        trackedStep={id}
        currentStep={step}
        totalSteps={4}
        cta={null}
      >
        Body
      </OutreachFlowShell>,
    )

  it('fires a Viewed carrying the channel and step on entering a stage', () => {
    renderAt(1, 'purpose')

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.Flow.StepViewed, {
      channel: 'sms',
      medium: 'text',
      step: 'purpose',
    })
  })

  it('fires nothing when the caller opts out with a null step', () => {
    render(
      <OutreachFlowShell
        {...baseProps}
        channel="sms"
        trackedStep={null}
        cta={null}
      >
        Body
      </OutreachFlowShell>,
    )

    expect(trackEvent).not.toHaveBeenCalled()
  })

  // Door knocking and phone banking borrow this chrome without adopting stage
  // tracking; omitting `channel` must stay silent rather than fire a partial event.
  it('fires nothing when no channel is given', () => {
    render(
      <OutreachFlowShell {...baseProps} trackedStep="purpose" cta={null}>
        Body
      </OutreachFlowShell>,
    )

    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('names the step just left when advancing, not the one arrived at', () => {
    const { rerender } = renderAt(1, 'purpose')
    vi.mocked(trackEvent).mockClear()

    rerender(
      <OutreachFlowShell
        {...baseProps}
        channel="sms"
        trackedStep="audience"
        currentStep={2}
        totalSteps={4}
        cta={null}
      >
        Body
      </OutreachFlowShell>,
    )

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.Flow.StepCompleted,
      {
        channel: 'sms',
        medium: 'text',
        step: 'purpose',
      },
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.Flow.StepViewed, {
      channel: 'sms',
      medium: 'text',
      step: 'audience',
    })
  })

  // Back re-entry is the case the rubric rule names explicitly: the stage is
  // entered again, so Viewed must re-fire, and nothing was completed.
  it('re-fires Viewed on Back without completing anything', () => {
    const { rerender } = renderAt(2, 'audience')
    vi.mocked(trackEvent).mockClear()

    rerender(
      <OutreachFlowShell
        {...baseProps}
        channel="sms"
        trackedStep="purpose"
        currentStep={1}
        totalSteps={4}
        cta={null}
      >
        Body
      </OutreachFlowShell>,
    )

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.Flow.StepViewed, {
      channel: 'sms',
      medium: 'text',
      step: 'purpose',
    })
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Outreach.Flow.StepCompleted,
      expect.anything(),
    )
  })
})

describe('OutreachFlowShell terminal stage and session reset', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear()
  })

  const shell = (props: {
    step: string | null
    current: number
    settled?: boolean
    open?: boolean
  }) => (
    <OutreachFlowShell
      {...baseProps}
      open={props.open ?? true}
      channel="sms"
      trackedStep={props.step}
      settled={props.settled ?? false}
      currentStep={props.current}
      totalSteps={4}
      cta={null}
    >
      Body
    </OutreachFlowShell>
  )

  // The conversion step: the caller drops trackedStep to null at the same
  // moment it settles, so without the settled branch this Completed is lost.
  it('completes the final stage when the flow settles', () => {
    const { rerender } = render(shell({ step: 'review', current: 4 }))
    vi.mocked(trackEvent).mockClear()

    rerender(shell({ step: null, current: 4, settled: true }))

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.Flow.StepCompleted,
      { channel: 'sms', medium: 'text', step: 'review' },
    )
  })

  it('completes the final stage once, not on every later render', () => {
    const { rerender } = render(shell({ step: 'review', current: 4 }))
    rerender(shell({ step: null, current: 4, settled: true }))
    vi.mocked(trackEvent).mockClear()

    rerender(shell({ step: null, current: 4, settled: true }))

    expect(trackEvent).not.toHaveBeenCalled()
  })

  // The gate borrows this chrome mid-flow: trackedStep goes null without
  // settling, so nothing completes and the stage keeps its place.
  it('completes nothing when the stages are left without settling', () => {
    const { rerender } = render(shell({ step: 'audience', current: 2 }))
    vi.mocked(trackEvent).mockClear()

    rerender(shell({ step: null, current: 2 }))

    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('re-fires Viewed and completes nothing when the gate returns to the same stage', () => {
    const { rerender } = render(shell({ step: 'audience', current: 2 }))
    rerender(shell({ step: null, current: 2 }))
    vi.mocked(trackEvent).mockClear()

    rerender(shell({ step: 'audience', current: 2 }))

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.Flow.StepViewed, {
      channel: 'sms',
      medium: 'text',
      step: 'audience',
    })
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Outreach.Flow.StepCompleted,
      expect.anything(),
    )
  })

  // Reopening is a fresh funnel. Without the reset, arriving at step 1 after a
  // close from step 3 reads as a backward move on the old session, and a later
  // advance would complete a stage from a run the user already abandoned.
  it('starts a fresh funnel on reopen rather than continuing the closed one', () => {
    const { rerender } = render(shell({ step: 'compose', current: 3 }))
    rerender(shell({ step: 'compose', current: 3, open: false }))
    vi.mocked(trackEvent).mockClear()

    rerender(shell({ step: 'purpose', current: 1 }))
    rerender(shell({ step: 'audience', current: 2 }))

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.Flow.StepViewed, {
      channel: 'sms',
      medium: 'text',
      step: 'purpose',
    })
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.Flow.StepCompleted,
      { channel: 'sms', medium: 'text', step: 'purpose' },
    )
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Outreach.Flow.StepCompleted,
      { channel: 'sms', medium: 'text', step: 'compose' },
    )
  })
})

// Robocall has no success screen, so it settles while still reporting its last
// stage. SMS and social swap in a success screen and drop trackedStep to null.
// Both must record the terminal completion exactly once, which is why settling
// is handled before trackedStep rather than inside its null branch.
describe('OutreachFlowShell settling without a success screen', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear()
  })

  const payStep = (settled: boolean) => (
    <OutreachFlowShell
      {...baseProps}
      channel="robocall"
      trackedStep="pay"
      settled={settled}
      currentStep={4}
      totalSteps={4}
      cta={null}
    >
      Body
    </OutreachFlowShell>
  )

  it('completes the terminal stage when the caller keeps reporting it', () => {
    const { rerender } = render(payStep(false))
    vi.mocked(trackEvent).mockClear()

    rerender(payStep(true))

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.Flow.StepCompleted,
      {
        channel: 'robocall',
        medium: 'robocall',
        step: 'pay',
      },
    )
  })

  it('does not re-view the terminal stage when it settles', () => {
    const { rerender } = render(payStep(false))
    vi.mocked(trackEvent).mockClear()

    rerender(payStep(true))

    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Outreach.Flow.StepViewed,
      expect.anything(),
    )
  })

  it('completes the terminal stage once across later renders', () => {
    const { rerender } = render(payStep(false))
    rerender(payStep(true))
    vi.mocked(trackEvent).mockClear()

    rerender(payStep(true))

    expect(trackEvent).not.toHaveBeenCalled()
  })

  // Reopening an already-finished flow traverses no stage, so it completes none.
  it('completes nothing when the flow opens already settled', () => {
    render(payStep(true))

    expect(trackEvent).not.toHaveBeenCalled()
  })
})

describe('OutreachFlowShell stage attribution', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear()
  })

  it('carries the source and the lock on each stage event', () => {
    const { rerender } = render(
      <OutreachFlowShell
        {...baseProps}
        channel="door"
        source="campaign_plan"
        locked
        trackedStep="purpose"
        currentStep={1}
        totalSteps={4}
        cta={null}
      >
        Body
      </OutreachFlowShell>,
    )
    rerender(
      <OutreachFlowShell
        {...baseProps}
        channel="door"
        source="campaign_plan"
        locked
        trackedStep="who"
        currentStep={2}
        totalSteps={4}
        cta={null}
      >
        Body
      </OutreachFlowShell>,
    )

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.Flow.StepCompleted,
      {
        channel: 'door',
        medium: 'doorKnocking',
        step: 'purpose',
        source: 'campaign_plan',
        locked: true,
      },
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.Flow.StepViewed, {
      channel: 'door',
      medium: 'doorKnocking',
      step: 'who',
      source: 'campaign_plan',
      locked: true,
    })
  })

  it('holds stage events while the lock is unresolved, then reports it', () => {
    const shell = (locked: boolean | null) => (
      <OutreachFlowShell
        {...baseProps}
        channel="sms"
        source="outreach_page"
        locked={locked}
        trackedStep="purpose"
        currentStep={1}
        totalSteps={4}
        cta={null}
      >
        Body
      </OutreachFlowShell>
    )
    const { rerender } = render(shell(null))
    expect(trackEvent).not.toHaveBeenCalled()

    rerender(shell(true))

    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.Flow.StepViewed, {
      channel: 'sms',
      medium: 'text',
      step: 'purpose',
      source: 'outreach_page',
      locked: true,
    })
  })
})

describe('OutreachFlowShell with the lock frozen at open', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear()
  })

  const gateState = (
    overrides: Partial<OutreachGateState>,
  ): OutreachGateState => ({
    enabled: true,
    resolved: true,
    requirement: 'pro',
    twoStep: true,
    membership: null,
    tcrCompliance: null,
    ...overrides,
  })

  const Flow = ({
    open,
    gate,
    step,
  }: {
    open: boolean
    gate: OutreachGateState
    step: number
  }) => {
    const locked = useLockedAtOpen(open, gate)
    return (
      <OutreachFlowShell
        {...baseProps}
        open={open}
        channel="sms"
        source="outreach_page"
        locked={locked}
        trackedStep={`step-${step}`}
        currentStep={step}
        totalSteps={4}
        cta={null}
      >
        Body
      </OutreachFlowShell>
    )
  }

  it('keeps reporting locked on the steps after an in-flow upgrade', () => {
    const { rerender } = render(
      <Flow open gate={gateState({ requirement: 'pro' })} step={1} />,
    )
    // Payment lands mid-flow: the live requirement clears.
    rerender(<Flow open gate={gateState({ requirement: null })} step={1} />)
    rerender(<Flow open gate={gateState({ requirement: null })} step={2} />)

    expect(trackEvent).toHaveBeenLastCalledWith(
      EVENTS.Outreach.Flow.StepViewed,
      expect.objectContaining({ step: 'step-2', locked: true }),
    )
  })

  it('waits for membership before freezing, so a free first step reads locked', () => {
    const { rerender } = render(
      <Flow
        open
        gate={gateState({ resolved: false, enabled: false, requirement: null })}
        step={1}
      />,
    )
    expect(trackEvent).not.toHaveBeenCalled()

    rerender(<Flow open gate={gateState({ requirement: 'pro' })} step={1} />)

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.Flow.StepViewed,
      expect.objectContaining({ step: 'step-1', locked: true }),
    )
  })

  it('freezes afresh on the next open', () => {
    const { rerender } = render(
      <Flow open gate={gateState({ requirement: 'pro' })} step={1} />,
    )
    rerender(
      <Flow open={false} gate={gateState({ requirement: null })} step={1} />,
    )
    vi.mocked(trackEvent).mockClear()
    rerender(<Flow open gate={gateState({ requirement: null })} step={1} />)

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.Flow.StepViewed,
      expect.objectContaining({ step: 'step-1', locked: false }),
    )
  })
})
