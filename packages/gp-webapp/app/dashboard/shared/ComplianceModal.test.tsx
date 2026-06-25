import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { ComplianceModal } from './ComplianceModal'

describe('ComplianceModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the PIN-entry prompt for a submitted registration', () => {
    render(
      <ComplianceModal
        open
        tcrComplianceStatus="submitted"
        onClose={vi.fn()}
      />,
    )

    expect(
      screen.getByText('Submit your PIN to finish texting registration'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Action required: register for texting compliance'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Enter PIN' })).toHaveAttribute(
      'href',
      '/dashboard/profile/texting-compliance/submit-pin',
    )
  })

  it('shows the under-review prompt for a pending registration', () => {
    render(
      <ComplianceModal open tcrComplianceStatus="pending" onClose={vi.fn()} />,
    )

    expect(
      screen.getByText('Texting registration under review'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
  })

  it('shows the needs-attention prompt for a rejected registration', () => {
    render(
      <ComplianceModal open tcrComplianceStatus="rejected" onClose={vi.fn()} />,
    )

    expect(
      screen.getByText('Texting registration needs attention'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Contact Support' }),
    ).toHaveAttribute('href', 'mailto:support@goodparty.org')
  })

  it('shows the error prompt for an errored registration', () => {
    render(
      <ComplianceModal open tcrComplianceStatus="error" onClose={vi.fn()} />,
    )

    expect(screen.getByText('Registration error')).toBeInTheDocument()
  })

  it('routes the registration prompt to the election-filing form', () => {
    render(
      <ComplianceModal open tcrComplianceStatus={null} onClose={vi.fn()} />,
    )

    expect(
      screen.getByText('Action required: register for texting compliance'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /You'll need your Campaign EIN and your official filing link\. Ready/,
      ),
    ).toBeInTheDocument()
    // Already-Pro candidates with no TCR record must land on the registration
    // form, not the pre-payment Pro-upgrade wizard, which dead-ends Pro users
    // on its SUCCESS surface and loops them back to the dashboard (ENG-10441).
    expect(
      screen.getByRole('link', { name: 'Start Registration' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/profile/texting-compliance/election-filing',
    )
  })
})
