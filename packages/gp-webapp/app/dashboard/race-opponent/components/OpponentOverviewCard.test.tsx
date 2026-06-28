import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import OpponentOverviewCard from './OpponentOverviewCard'

describe('OpponentOverviewCard', () => {
  it('renders the name and initials', () => {
    render(<OpponentOverviewCard name="Graciela Guzmán" initials="GG" />)
    expect(screen.getByText('Graciela Guzmán')).toBeInTheDocument()
    expect(screen.getByText('GG')).toBeInTheDocument()
  })

  it('shows party and incumbent badges when provided', () => {
    render(
      <OpponentOverviewCard
        name="Graciela Guzmán"
        initials="GG"
        party="Democrat"
        isIncumbent
      />,
    )
    expect(screen.getByText('Democrat')).toBeInTheDocument()
    expect(screen.getByText('Incumbent')).toBeInTheDocument()
  })

  it('shows a challenger badge when isIncumbent is false', () => {
    render(
      <OpponentOverviewCard
        name="Trevor Halberstam"
        initials="TH"
        isIncumbent={false}
      />,
    )
    expect(screen.getByText('Challenger')).toBeInTheDocument()
    expect(screen.queryByText('Incumbent')).not.toBeInTheDocument()
  })

  it('omits party and incumbent/challenger badges and summary when absent', () => {
    render(
      <OpponentOverviewCard
        name="Trevor Halberstam"
        initials="TH"
        party={null}
        isIncumbent={null}
        summary={null}
      />,
    )
    expect(screen.queryByText('Democrat')).not.toBeInTheDocument()
    expect(screen.queryByText('Incumbent')).not.toBeInTheDocument()
    expect(screen.queryByText('Challenger')).not.toBeInTheDocument()
    // Name and initials are still present.
    expect(screen.getByText('Trevor Halberstam')).toBeInTheDocument()
    expect(screen.getByText('TH')).toBeInTheDocument()
  })

  it('renders the summary line when present', () => {
    render(
      <OpponentOverviewCard
        name="Graciela Guzmán"
        initials="GG"
        summary="Two-term incumbent with strong labor backing."
      />,
    )
    expect(
      screen.getByText('Two-term incumbent with strong labor backing.'),
    ).toBeInTheDocument()
  })
})
