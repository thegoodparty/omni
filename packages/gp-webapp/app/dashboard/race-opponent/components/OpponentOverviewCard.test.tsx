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

  it('omits party and incumbent badges when absent', () => {
    render(<OpponentOverviewCard name="Trevor Halberstam" initials="TH" />)
    expect(screen.queryByText('Democrat')).not.toBeInTheDocument()
    expect(screen.queryByText('Incumbent')).not.toBeInTheDocument()
  })
})
