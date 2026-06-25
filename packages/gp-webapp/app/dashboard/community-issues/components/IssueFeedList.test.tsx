import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { CommunityIssueCard } from 'gpApi/api-endpoints'
import IssueFeedList from './IssueFeedList'

vi.mock('./CommunityIssuesChatDock', () => ({ default: () => null }))

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [null, vi.fn(), false],
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))

const makeCard = (
  overrides: Partial<CommunityIssueCard> = {},
): CommunityIssueCard => ({
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

    const rankBadges = screen.getAllByText(/^\d+$/)
    expect(rankBadges).toHaveLength(3)
    expect(rankBadges[0]).toHaveTextContent('1')
    expect(rankBadges[1]).toHaveTextContent('2')
    expect(rankBadges[2]).toHaveTextContent('3')
  })

  it('shows generating placeholder when feed is empty and refresh is running', () => {
    render(<IssueFeedList topCommunity={runningFeed} trending={emptyFeed} />)

    const skeletons = document.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })
})
