import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import OpponentOverviewCard from './OpponentOverviewCard'

describe('OpponentOverviewCard', () => {
  it('renders the name and initials', () => {
    render(<OpponentOverviewCard name="Graciela Guzmán" initials="GG" />)
    expect(screen.getByText('Graciela Guzmán')).toBeInTheDocument()
    expect(screen.getByText('GG')).toBeInTheDocument()
  })

  it('renders a party · Incumbent descriptor when provided', () => {
    render(
      <OpponentOverviewCard
        name="Graciela Guzmán"
        initials="GG"
        party="Democrat"
        isIncumbent
      />,
    )
    expect(screen.getByText('Democrat · Incumbent')).toBeInTheDocument()
  })

  it('uses "Challenger" in the descriptor when isIncumbent is false', () => {
    render(
      <OpponentOverviewCard
        name="Trevor Halberstam"
        initials="TH"
        party="Republican"
        isIncumbent={false}
      />,
    )
    expect(screen.getByText('Republican · Challenger')).toBeInTheDocument()
  })

  it('omits the descriptor when party and incumbency are absent', () => {
    render(
      <OpponentOverviewCard
        name="Trevor Halberstam"
        initials="TH"
        party={null}
        isIncumbent={null}
      />,
    )
    expect(screen.queryByText(/·/)).not.toBeInTheDocument()
    expect(screen.queryByText('Incumbent')).not.toBeInTheDocument()
    expect(screen.queryByText('Challenger')).not.toBeInTheDocument()
    // Name and initials are still present.
    expect(screen.getByText('Trevor Halberstam')).toBeInTheDocument()
    expect(screen.getByText('TH')).toBeInTheDocument()
  })

  it.each([
    ['primary_threat', 'Primary threat'],
    ['watch_closely', 'Watch closely'],
    ['low_priority', 'Low priority'],
  ] as const)('renders the %s tier badge label', (tier, label) => {
    render(
      <OpponentOverviewCard name="Chuck B" initials="CB" threatTier={tier} />,
    )
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('renders no threat-tier badge when threatTier is undefined', () => {
    render(<OpponentOverviewCard name="Chuck B" initials="CB" />)
    expect(screen.queryByText('Primary threat')).not.toBeInTheDocument()
    expect(screen.queryByText('Watch closely')).not.toBeInTheDocument()
    expect(screen.queryByText('Low priority')).not.toBeInTheDocument()
  })
})
