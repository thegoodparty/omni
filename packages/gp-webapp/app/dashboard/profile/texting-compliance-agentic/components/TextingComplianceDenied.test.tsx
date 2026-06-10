import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import TextingComplianceDenied from './TextingComplianceDenied'

describe('TextingComplianceDenied', () => {
  it('renders the title and the support email mailto link', () => {
    render(<TextingComplianceDenied />)

    expect(
      screen.getByText('Your profile needs updates before sending texts'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'campaignsuccess@goodparty.org' }),
    ).toHaveAttribute('href', 'mailto:campaignsuccess@goodparty.org')
  })

  // The redesign drops the generic "Texting Compliance" heading (ENG-10335).
  it('does not render a "Texting Compliance" heading', () => {
    render(<TextingComplianceDenied />)

    expect(screen.queryByText('Texting Compliance')).toBeNull()
  })
})
