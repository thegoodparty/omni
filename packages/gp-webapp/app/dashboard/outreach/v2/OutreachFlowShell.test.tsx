import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { OutreachFlowShell } from './OutreachFlowShell'

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
