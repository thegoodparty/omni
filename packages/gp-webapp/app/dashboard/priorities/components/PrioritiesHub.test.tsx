import { describe, expect, it } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { fireEvent, screen } from '@testing-library/react'
import type { Priority } from '@goodparty_org/contracts'
import type { CommunityIssueCard } from 'gpApi/api-endpoints'
import PrioritiesHub from './PrioritiesHub'

const priority = (overrides: Partial<Priority> = {}): Priority => ({
  id: 'p1',
  electedOfficeId: 'eo1',
  title: 'Fix the flooding on Oak Street',
  description: 'Two blocks flood every heavy rain.',
  source: 'user_stated',
  sourceCampaignPositionId: null,
  targetDate: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
})

const issue = (
  overrides: Partial<CommunityIssueCard> = {},
): CommunityIssueCard => ({
  id: 'i1',
  list: 'top_community',
  category: 'infrastructure',
  priority: 'high',
  title: 'Sidewalk gaps near the school',
  summary: 'Parents raise this at every meeting.',
  rank: 1,
  prioritized: false,
  ...overrides,
})

describe('PrioritiesHub', () => {
  it('tells the user what to do when they hold no priorities', () => {
    render(<PrioritiesHub priorities={[]} seedIssues={[]} />)
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument()
  })

  it('ranks the priorities it was given', () => {
    render(
      <PrioritiesHub
        priorities={[priority(), priority({ id: 'p2', title: 'Speed humps' })]}
        seedIssues={[]}
      />,
    )
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Speed humps')).toBeInTheDocument()
  })

  it('offers only the issues the user has not already picked up', () => {
    render(
      <PrioritiesHub
        priorities={[]}
        seedIssues={[
          issue(),
          issue({ id: 'i2', title: 'Already mine', prioritized: true }),
        ]}
      />,
    )
    expect(
      screen.getByText('Sidewalk gaps near the school'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Already mine')).not.toBeInTheDocument()
  })

  it('badges each row with the lane it came from', () => {
    render(
      <PrioritiesHub
        priorities={[
          priority({ source: 'community_issue' }),
          priority({ id: 'p2', title: 'Speed humps', source: 'user_stated' }),
        ]}
        seedIssues={[]}
      />,
    )
    // The lane chips carry a count, the row badges do not, so the badge is the
    // bare label.
    expect(screen.getByText('From your community')).toBeInTheDocument()
    expect(screen.getByText('Yours')).toBeInTheDocument()
  })

  it('filters to one lane and empties honestly when it holds nothing', () => {
    render(
      <PrioritiesHub
        priorities={[priority({ source: 'user_stated' })]}
        seedIssues={[]}
      />,
    )
    fireEvent.click(screen.getByText('From your community (0)'))
    expect(screen.getByText('Nothing in this lane yet.')).toBeInTheDocument()
    expect(
      screen.queryByText('Fix the flooding on Oak Street'),
    ).not.toBeInTheDocument()
  })
})
