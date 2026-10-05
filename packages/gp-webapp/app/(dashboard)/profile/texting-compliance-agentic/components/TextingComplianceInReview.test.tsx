import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import TextingComplianceInReview from './TextingComplianceInReview'

describe('TextingComplianceInReview', () => {
  it('renders the provided title and description', () => {
    render(
      <TextingComplianceInReview
        title="Your candidate profile is being reviewed"
        description="Review takes 3-7 business days."
      />,
    )

    expect(
      screen.getByText('Your candidate profile is being reviewed'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Review takes 3-7 business days.'),
    ).toBeInTheDocument()
  })

  // The redesign drops the generic "Texting Compliance" heading: the status
  // title is the card's only heading, matching Figma (ENG-10335).
  it('does not render a "Texting Compliance" heading', () => {
    render(<TextingComplianceInReview title="In review" />)

    expect(screen.queryByText('Texting Compliance')).toBeNull()
  })

  it('renders the decorative timer icon', () => {
    const { container } = render(
      <TextingComplianceInReview title="In review" />,
    )

    expect(container.querySelector('svg')).not.toBeNull()
  })
})
