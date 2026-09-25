import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { OutreachFlowShell } from './OutreachFlowShell'

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
        step: 'purpose',
      },
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.Flow.StepViewed, {
      channel: 'sms',
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
      step: 'purpose',
    })
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Outreach.Flow.StepCompleted,
      expect.anything(),
    )
  })
})
