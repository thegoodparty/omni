import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { EmailSummary } from './EmailSummary'
import { WIN_EMAIL_SURFACE } from './emailSurface'

const renderSummary = (
  credit?: { label: string; cents: number; leftCents?: number },
  priceCents = 8400,
) =>
  render(
    <EmailSummary
      surface={WIN_EMAIL_SURFACE}
      reach={null}
      priceCents={priceCents}
      credit={credit}
      when="Now"
    />,
  )

describe('EmailSummary credit lines', () => {
  it('takes the credit off the price and says what is left', () => {
    renderSummary({
      label: 'From your $175.00 outreach credit',
      cents: 8400,
      leftCents: 9100,
    })

    expect(screen.getByText('Cost')).toBeInTheDocument()
    expect(screen.getByText('−$84.00')).toBeInTheDocument()
    expect(screen.getByText('Up to $0.00')).toBeInTheDocument()
    expect(
      screen.getByText('$91.00 outreach credit left after it sends.'),
    ).toBeInTheDocument()
  })

  it('totals what the credit leaves when it covers part', () => {
    renderSummary({ label: 'Outreach credit used', cents: 4200 })

    expect(screen.getByText('Outreach credit used')).toBeInTheDocument()
    expect(screen.getByText('Up to $42.00')).toBeInTheDocument()
    expect(screen.queryByText(/left after/)).not.toBeInTheDocument()
  })

  it('shows only the total with no credit', () => {
    renderSummary()

    expect(screen.queryByText('Cost')).not.toBeInTheDocument()
    expect(screen.getByText('Up to $84.00')).toBeInTheDocument()
  })
})
