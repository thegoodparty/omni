import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import IssueDetail from './IssueDetail'
import type {
  CommunityIssueDetail,
  CommunityIssueContent,
} from 'gpApi/api-endpoints'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

vi.mock('./PrioritizeButton', () => ({
  default: ({ issueId }: { issueId: string }) => (
    <div data-testid="prioritize-button">{issueId}</div>
  ),
}))

vi.mock('./CommunityIssuesChatDock', () => ({ default: () => null }))

const makeDetail = (): CommunityIssueContent => ({
  sources: [],
  overview: { summary: 'Overview text', source_ids: [] },
})

const makeFeedDetail = (
  overrides: Partial<CommunityIssueDetail> = {},
): CommunityIssueDetail => ({
  id: 'issue-1',
  list: 'top_community',
  category: 'Housing',
  priority: 'high',
  title: 'Housing Crisis',
  summary: 'Rising rents are a top concern.',
  rank: 1,
  prioritized: false,
  archived: false,
  detail: makeDetail(),
  relatedBriefings: [],
  priorityId: null,
  ...overrides,
})

beforeEach(() => {
  vi.mocked(trackEvent).mockClear()
})

describe('IssueDetail actions', () => {
  it('renders a "Run a poll" link pointing to the poll create route', () => {
    render(<IssueDetail issue={makeFeedDetail()} />)
    const link = screen.getByRole('link', { name: /run a poll/i })
    expect(link).toHaveAttribute('href', '/dashboard/polls/create')
  })

  it('fires RunPollClicked event when "Run a poll" is clicked', async () => {
    render(<IssueDetail issue={makeFeedDetail()} />)
    await userEvent.click(screen.getByRole('link', { name: /run a poll/i }))
    expect(vi.mocked(trackEvent)).toHaveBeenCalledWith(
      EVENTS.CommunityIssues.RunPollClicked,
      { issueId: 'issue-1' },
    )
  })
})
