import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { SelfResearchFinding } from 'gpApi/api-endpoints'
import OpponentHandbook from './OpponentHandbook'

const sourced: SelfResearchFinding = {
  id: 1,
  researchId: 10,
  claim: 'Voted against the transit bond in 2022',
  sourceUrl: 'https://news.example.com/transit-vote',
  sourceExtract: 'The incumbent voted no on the transit bond.',
  sourceTitle: 'City Record: Transit vote',
  sourceReachableAt: '2026-06-20T12:00:00.000Z',
  category: 'Voting record',
  occurredAt: '2022-05-01T00:00:00.000Z',
  draftedResponse: null,
  createdAt: '2026-06-20T12:00:00.000Z',
}

// sourceUrl is non-empty at the type level, but the candidate-facing UI re-checks
// at runtime and must drop anything without a usable link. An empty-string
// sourceUrl models a finding that slipped through without a verifiable source.
const unsourced: SelfResearchFinding = {
  ...sourced,
  id: 2,
  claim: 'Unverified rumor about a donor',
  sourceUrl: '',
  sourceExtract: '',
  sourceTitle: null,
  category: 'Donors',
}

describe('<OpponentHandbook>', () => {
  it('renders a finding with a working source link', () => {
    render(<OpponentHandbook opponentName="Jane Doe" findings={[sourced]} />)

    expect(
      screen.getByText('Voted against the transit bond in 2022'),
    ).toBeInTheDocument()

    const link = screen.getByRole('link', {
      name: /City Record: Transit vote/i,
    })
    expect(link).toHaveAttribute(
      'href',
      'https://news.example.com/transit-vote',
    )
  })

  it('does not render a finding without a source link (sourced-or-silent)', () => {
    render(<OpponentHandbook opponentName="Jane Doe" findings={[unsourced]} />)

    expect(
      screen.queryByText('Unverified rumor about a donor'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders only the sourced findings when the list is mixed', () => {
    render(
      <OpponentHandbook
        opponentName="Jane Doe"
        findings={[sourced, unsourced]}
      />,
    )

    expect(
      screen.getByText('Voted against the transit bond in 2022'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Unverified rumor about a donor'),
    ).not.toBeInTheDocument()
    // Exactly one source link — the unsourced finding contributes none.
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('groups sourced findings by category', () => {
    const other: SelfResearchFinding = {
      ...sourced,
      id: 3,
      claim: 'Took donations from a real-estate PAC',
      sourceUrl: 'https://news.example.com/pac',
      sourceTitle: 'FEC filing',
      category: 'Donors',
    }
    render(
      <OpponentHandbook opponentName="Jane Doe" findings={[sourced, other]} />,
    )

    expect(screen.getByText('Voting record')).toBeInTheDocument()
    expect(screen.getByText('Donors')).toBeInTheDocument()
  })
})
