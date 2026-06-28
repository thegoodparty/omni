import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type {
  RaceOpponentActivityItem,
  RaceOpponentActivityResponse,
} from 'gpApi/api-endpoints'
import OpponentActivityFeed from './OpponentActivityFeed'

const baseItem: RaceOpponentActivityItem = {
  id: 1,
  researchId: 10,
  claim: 'New endorsement from the county party',
  sourceUrl: 'https://news.example.com/endorsement',
  sourceExtract: 'The county party endorsed the incumbent.',
  sourceTitle: 'County party press release',
  sourceReachableAt: '2026-06-26T12:00:00.000Z',
  category: 'Endorsements',
  occurredAt: '2026-06-26T00:00:00.000Z',
  draftedResponse: null,
  createdAt: '2026-06-26T12:00:00.000Z',
  newSinceLastVisit: true,
}

const makeActivity = (
  findings: RaceOpponentActivityItem[],
): RaceOpponentActivityResponse => ({
  findings,
  refresh: { status: 'completed', lastCompletedAt: '2026-06-26T12:00:00.000Z' },
})

describe('<OpponentActivityFeed>', () => {
  it('flags newSinceLastVisit items with a New badge', () => {
    render(<OpponentActivityFeed activity={makeActivity([baseItem])} />)

    const card = screen
      .getByText('New endorsement from the county party')
      .closest('[data-slot="card"]')
    expect(card).not.toBeNull()
    expect(within(card as HTMLElement).getByText('New')).toBeInTheDocument()
  })

  it('does not flag items that are not new since last visit', () => {
    const old: RaceOpponentActivityItem = {
      ...baseItem,
      id: 2,
      claim: 'Older sourced finding',
      newSinceLastVisit: false,
    }
    render(<OpponentActivityFeed activity={makeActivity([old])} />)

    expect(screen.getByText('Older sourced finding')).toBeInTheDocument()
    expect(screen.queryByText('New')).not.toBeInTheDocument()
  })

  it('drops findings without a source link (sourced-or-silent)', () => {
    const unsourced: RaceOpponentActivityItem = {
      ...baseItem,
      id: 3,
      claim: 'Unsourced activity item',
      sourceUrl: '',
    }
    render(<OpponentActivityFeed activity={makeActivity([unsourced])} />)

    expect(
      screen.queryByText('Unsourced activity item'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
