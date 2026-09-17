import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import TextingComplianceApproved from './TextingComplianceApproved'

describe('TextingComplianceApproved', () => {
  it('renders the title and a provided description', () => {
    render(
      <TextingComplianceApproved
        title="Your profile has been approved!"
        description="Claim up to 5,000 free texts in your first campaign. Schedule your introduction text message today."
      />,
    )

    expect(
      screen.getByText('Your profile has been approved!'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/claim up to 5,000 free texts/i),
    ).toBeInTheDocument()
  })

  // The default description must not promise free texts: this component is
  // rendered off an approved TCR record, but the free-texts discount at
  // checkout is gated separately on Campaign.hasFreeTextsOffer. A default that
  // advertises the offer would mis-promise it whenever the caller forgets to
  // pass a description (ENG-10440).
  it('falls back to a neutral description that does not promise free texts', () => {
    render(<TextingComplianceApproved />)

    expect(
      screen.queryByText(/claim up to 5,000 free texts/i),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/schedule your introduction text message/i),
    ).toBeInTheDocument()
  })

  it('links the Schedule button to the outreach hub', () => {
    render(<TextingComplianceApproved />)

    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveAttribute(
      'href',
      '/dashboard/outreach',
    )
  })

  // The redesign drops the generic "Texting Compliance" heading (ENG-10335).
  it('does not render a "Texting Compliance" heading', () => {
    render(<TextingComplianceApproved />)

    expect(screen.queryByText('Texting Compliance')).toBeNull()
  })
})
