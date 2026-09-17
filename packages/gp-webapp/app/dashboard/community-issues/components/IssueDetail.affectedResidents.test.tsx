import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { CommunityIssueDetail } from 'gpApi/api-endpoints'
import { useAffectedResidentsFlag } from '@shared/experiments/affectedResidentsFlag'
import IssueDetail from './IssueDetail'

vi.mock('./CommunityIssuesChatDock', () => ({ default: () => null }))
vi.mock('@shared/experiments/affectedResidentsFlag', () => ({
  useAffectedResidentsFlag: vi.fn(),
  AFFECTED_RESIDENTS_FLAG_KEY: 'serve-affected-residents',
}))

const mockFlag = vi.mocked(useAffectedResidentsFlag)

const issue: CommunityIssueDetail = {
  id: 'issue-1',
  list: 'trending',
  category: 'housing_and_development',
  priority: 'high',
  title: 'Attainable Housing District',
  summary: 'A tax break for small rentals.',
  rank: 1,
  prioritized: false,
  archived: false,
  detail: {
    sources: [],
    overview: { summary: 'Overview text', source_ids: [] },
  },
  relatedBriefings: [],
  priorityId: null,
}

const CARD = /see who this affects/i

describe('IssueDetail affected-residents entry point', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('links to the per-issue list when the flag is on and a list exists', () => {
    mockFlag.mockReturnValue({ ready: true, enabled: true })

    render(<IssueDetail issue={issue} affectedResidentCount={310} devPreview />)

    const link = screen.getByRole('link', { name: CARD })
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/community-issues/issue-1/affected-residents',
    )
    expect(screen.getByText(/310 constituents/i)).toBeInTheDocument()
  })

  it('renders nothing when the flag is off, even though a list exists', () => {
    mockFlag.mockReturnValue({ ready: true, enabled: false })

    render(<IssueDetail issue={issue} affectedResidentCount={310} devPreview />)

    expect(screen.queryByRole('link', { name: CARD })).not.toBeInTheDocument()
  })

  it('renders nothing while the flag is still loading', () => {
    mockFlag.mockReturnValue({ ready: false, enabled: false })

    render(<IssueDetail issue={issue} affectedResidentCount={310} devPreview />)

    expect(screen.queryByRole('link', { name: CARD })).not.toBeInTheDocument()
  })

  it('renders nothing when the office has no list for this issue', () => {
    // The flag is not the access control: gp-api returns null for an issue with
    // no list and for another office's issue alike, and a null count is how
    // that reaches the client.
    mockFlag.mockReturnValue({ ready: true, enabled: true })

    render(
      <IssueDetail issue={issue} affectedResidentCount={null} devPreview />,
    )

    expect(screen.queryByRole('link', { name: CARD })).not.toBeInTheDocument()
  })

  it('does not track flag exposure from the entry point', () => {
    mockFlag.mockReturnValue({ ready: true, enabled: true })

    render(<IssueDetail issue={issue} affectedResidentCount={310} devPreview />)

    expect(mockFlag).toHaveBeenCalledWith(false)
  })
})
