import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { ComplianceModal } from './ComplianceModal'

describe('ComplianceModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the PIN-entry prompt for a submitted registration with a Peerly identity', () => {
    render(
      <ComplianceModal
        open
        tcrCompliance={{ status: 'submitted', peerlyIdentityId: '11540708' }}
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

  // A validation hold means the filing link could not be verified; the fix is
  // corrected filing details, and the resubmit is what clears the hold
  // server-side — so the CTA must reach the election-filing form, not a PIN
  // box for a PIN that was never issued (ENG-11089).
  it('routes a held submitted registration to the election-filing form', () => {
    render(
      <ComplianceModal
        open
        tcrCompliance={{
          status: 'submitted',
          peerlyIdentityId: null,
          cvValidationFailedAt: '2026-09-11T13:53:29.869Z',
        }}
        onClose={vi.fn()}
      />,
    )

    expect(
      screen.getByText('Update your election filing link'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Submit your PIN to finish texting registration'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Update Filing Details' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/profile/texting-compliance/election-filing',
    )
  })

  it('shows the in-progress prompt for a submitted registration that never reached Peerly', () => {
    render(
      <ComplianceModal
        open
        tcrCompliance={{ status: 'submitted', peerlyIdentityId: null }}
        onClose={vi.fn()}
      />,
    )

    expect(
      screen.getByText('Texting registration in progress'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Submit your PIN to finish texting registration'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Enter PIN' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
  })

  it('shows the under-review prompt for a pending registration', () => {
    render(
      <ComplianceModal
        open
        tcrCompliance={{ status: 'pending' }}
        onClose={vi.fn()}
      />,
    )

    expect(
      screen.getByText('Texting registration under review'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
  })

  it('shows the needs-attention prompt for a rejected registration', () => {
    render(
      <ComplianceModal
        open
        tcrCompliance={{ status: 'rejected' }}
        onClose={vi.fn()}
      />,
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
      <ComplianceModal
        open
        tcrCompliance={{ status: 'error' }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Registration error')).toBeInTheDocument()
  })

  it('routes the registration prompt to the election-filing form', () => {
    render(<ComplianceModal open tcrCompliance={null} onClose={vi.fn()} />)

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
