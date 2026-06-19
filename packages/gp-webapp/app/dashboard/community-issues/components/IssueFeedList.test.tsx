import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import IssueFeedList from './IssueFeedList'

const makeCard = (
  overrides: Partial<{
    id: string
    list: string
    category: string
    priority: string
    title: string
    summary: string
    rank: number | null
    prioritized: boolean
  }> = {},
) => ({
  id: 'issue-1',
  list: 'top_community',
  category: 'Housing',
  priority: 'high',
  title: 'Housing affordability',
  summary: 'Rising rents are a top concern.',
  rank: null,
  prioritized: false,
  ...overrides,
})

const emptyFeed = {
  issues: [],
  refresh: { status: 'completed' as const, lastCompletedAt: null },
}

const runningFeed = {
  issues: [],
  refresh: { status: 'running' as const, lastCompletedAt: null },
}

describe('GET /v1/community-issue-feed mock', () => {
  it('configures the api mock for the feed endpoint', () => {
    const mocker = api.mock('GET /v1/community-issue-feed', {
      status: 200,
      data: {
        issues: [makeCard({ id: 'mock-1', title: 'Mock Issue' })],
        refresh: { status: 'completed', lastCompletedAt: null },
      },
    })
    expect(mocker).toBeDefined()
  })
})

describe('IssueFeedList', () => {
  it('renders issues from both feeds', () => {
    const topCommunity = {
      issues: [makeCard({ id: 'tc-1', title: 'Top Issue', rank: 1 })],
      refresh: { status: 'completed' as const, lastCompletedAt: null },
    }
    const trending = {
      issues: [
        makeCard({ id: 'tr-1', title: 'Trending Issue', list: 'trending' }),
      ],
      refresh: { status: 'completed' as const, lastCompletedAt: null },
    }

    render(<IssueFeedList topCommunity={topCommunity} trending={trending} />)

    expect(screen.getByText('Top Issue')).toBeInTheDocument()
    expect(screen.getByText('Trending Issue')).toBeInTheDocument()
  })

  it('shows rank badges in ascending order for top community issues', () => {
    const topCommunity = {
      issues: [
        makeCard({ id: 'tc-2', title: 'Second Issue', rank: 2 }),
        makeCard({ id: 'tc-1', title: 'First Issue', rank: 1 }),
        makeCard({ id: 'tc-3', title: 'Third Issue', rank: 3 }),
      ],
      refresh: { status: 'completed' as const, lastCompletedAt: null },
    }

    render(<IssueFeedList topCommunity={topCommunity} trending={emptyFeed} />)

    const rankBadges = screen.getAllByText(/^#\d+$/)
    expect(rankBadges).toHaveLength(3)
    expect(rankBadges[0]).toHaveTextContent('#1')
    expect(rankBadges[1]).toHaveTextContent('#2')
    expect(rankBadges[2]).toHaveTextContent('#3')
  })

  it('shows generating placeholder when feed is empty and refresh is running', () => {
    render(<IssueFeedList topCommunity={runningFeed} trending={emptyFeed} />)

    const skeletons = document.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })
})
