import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { SelfResearchFinding } from 'gpApi/api-endpoints'
import SelfResearchReport from './SelfResearchReport'

const sourced: SelfResearchFinding = {
  id: 1,
  researchId: 10,
  claim: 'Missed three council votes in 2021',
  sourceUrl: 'https://news.example.com/missed-votes',
  sourceExtract: 'The candidate was absent for three votes.',
  sourceTitle: 'Local News: Attendance record',
  sourceReachableAt: '2026-06-20T12:00:00.000Z',
  category: 'Voting record',
  occurredAt: '2021-05-01T00:00:00.000Z',
  draftedResponse: 'I was caring for a sick family member during that period.',
  createdAt: '2026-06-20T12:00:00.000Z',
}

// sourceUrl is non-empty at the type level, but the UI re-checks at runtime and
// must drop anything without a usable link. An empty-string sourceUrl models a
// finding that slipped through without a verifiable source.
const unsourced: SelfResearchFinding = {
  ...sourced,
  id: 2,
  claim: 'Unverified rumor about past employment',
  sourceUrl: '',
  sourceExtract: '',
  sourceTitle: null,
  draftedResponse: null,
}

describe('<SelfResearchReport>', () => {
  it('renders a finding with a working source link and its drafted response', () => {
    render(<SelfResearchReport findings={[sourced]} />)

    expect(
      screen.getByText('Missed three council votes in 2021'),
    ).toBeInTheDocument()

    const link = screen.getByRole('link', {
      name: /Local News: Attendance record/i,
    })
    expect(link).toHaveAttribute(
      'href',
      'https://news.example.com/missed-votes',
    )

    expect(
      screen.getByText(
        'I was caring for a sick family member during that period.',
      ),
    ).toBeInTheDocument()
  })

  it('does not render a finding without a source link (sourced-or-silent)', () => {
    render(<SelfResearchReport findings={[unsourced]} />)

    expect(
      screen.queryByText('Unverified rumor about past employment'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(
      screen.getByText(/no sourced vulnerabilities were found/i),
    ).toBeInTheDocument()
  })

  it('renders only the sourced findings when the list is mixed', () => {
    render(<SelfResearchReport findings={[sourced, unsourced]} />)

    expect(
      screen.getByText('Missed three council votes in 2021'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Unverified rumor about past employment'),
    ).not.toBeInTheDocument()
    // Exactly one source link — the unsourced finding contributes none.
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})
