import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type {
  CommunityIssueContent,
  CommunityIssueDetail,
} from 'gpApi/api-endpoints'
import IssueDetail from './IssueDetail'

vi.mock('./CommunityIssuesChatDock', () => ({ default: () => null }))

const makeSource = (id: string) => ({
  id,
  name: `Source ${id}`,
  source_type: 'news' as const,
  url: `https://example.com/${id}`,
  publisher: `Publisher ${id}`,
})

const makeDetail = (
  overrides: Partial<CommunityIssueContent> = {},
): CommunityIssueContent => ({
  sources: [makeSource('s1'), makeSource('s2')],
  overview: { summary: 'Overview text', source_ids: ['s1'] },
  ...overrides,
})

const makeFeedDetail = (
  overrides: Partial<CommunityIssueDetail> = {},
): CommunityIssueDetail => ({
  id: 'issue-1',
  list: 'top_community',
  category: 'housing_and_development',
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

describe('IssueDetail', () => {
  it('renders all five subsections when all are present', () => {
    const detail = makeDetail({
      history: { summary: 'History text', source_ids: ['s2'] },
      quotes: {
        items: [{ text: 'A quote', attribution: 'Someone', source_id: 's1' }],
      },
      research: { summary: 'Research text', source_ids: ['s1'] },
      legislation: { summary: 'Legislation text', source_ids: ['s2'] },
    })
    render(<IssueDetail issue={makeFeedDetail({ detail })} />)

    expect(screen.getByText('Overview text')).toBeInTheDocument()
    expect(screen.getByText('History text')).toBeInTheDocument()
    expect(screen.getByText('A quote')).toBeInTheDocument()
    expect(screen.getByText('Research text')).toBeInTheDocument()
    expect(screen.getByText('Legislation text')).toBeInTheDocument()
  })

  it('renders only overview when other subsections are absent', () => {
    render(<IssueDetail issue={makeFeedDetail()} />)

    expect(screen.getByText('Overview text')).toBeInTheDocument()
    expect(screen.queryByText('History')).not.toBeInTheDocument()
    expect(screen.queryByText('Notable quotes')).not.toBeInTheDocument()
    expect(screen.queryByText('Research & data')).not.toBeInTheDocument()
    expect(screen.queryByText('Legislation')).not.toBeInTheDocument()
  })

  it('renders quote with attribution', () => {
    const detail = makeDetail({
      quotes: {
        items: [
          {
            text: 'Quote text here',
            attribution: 'Jane Doe',
            source_id: 's1',
          },
        ],
      },
    })
    render(<IssueDetail issue={makeFeedDetail({ detail })} />)

    expect(screen.getByText('Quote text here')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
  })

  it('renders source pill for overview source', () => {
    render(<IssueDetail issue={makeFeedDetail()} />)
    expect(screen.getByText('source:')).toBeInTheDocument()
  })

  it('renders sources collapsible with union of all sources', () => {
    render(<IssueDetail issue={makeFeedDetail()} />)
    expect(screen.getByText('Sources (2)')).toBeInTheDocument()
  })

  it('renders a related-briefing next-step card linking to the briefing', () => {
    const issue = makeFeedDetail({
      relatedBriefings: [
        {
          meetingBriefingId: 'b1',
          briefingItemId: 'item1',
          meetingDate: '2025-06-01',
        },
      ],
    })
    render(<IssueDetail issue={issue} />)
    const link = screen.getByRole('link', {
      name: /review the related meeting briefing/i,
    })
    expect(link).toHaveAttribute('href', '/dashboard/briefings/2025-06-01')
  })

  it('renders the issue title', () => {
    render(<IssueDetail issue={makeFeedDetail()} />)
    expect(screen.getByText('Housing Crisis')).toBeInTheDocument()
  })

  it('renders no-detail fallback when detail is null', () => {
    render(<IssueDetail issue={makeFeedDetail({ detail: null })} />)
    expect(
      screen.getByText('No detail available for this issue.'),
    ).toBeInTheDocument()
  })

  it('shows archived badge and hides prioritize button when archived', () => {
    render(
      <IssueDetail
        issue={makeFeedDetail({ archived: true, prioritized: false })}
      />,
    )
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /add to my priorities/i }),
    ).not.toBeInTheDocument()
  })

  it('hides archived badge and shows prioritize button when not archived', () => {
    render(
      <IssueDetail
        issue={makeFeedDetail({ archived: false, prioritized: false })}
      />,
    )
    expect(screen.queryByText('Archived')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /add to my priorities/i }),
    ).toBeInTheDocument()
  })
})
