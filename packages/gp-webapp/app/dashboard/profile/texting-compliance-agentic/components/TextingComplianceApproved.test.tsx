import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import TextingComplianceApproved from './TextingComplianceApproved'

describe('TextingComplianceApproved', () => {
  it('renders the title and description', () => {
    render(
      <TextingComplianceApproved title="Your profile has been approved!" />,
    )

    expect(
      screen.getByText('Your profile has been approved!'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/claim up to 5,000 free texts/i),
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
