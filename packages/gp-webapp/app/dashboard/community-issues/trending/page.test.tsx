import { describe, it, expect, vi, beforeEach } from 'vitest'
import { type ReactNode } from 'react'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { CommunityIssueCard } from 'gpApi/api-endpoints'
import Page from './page'

const { mockServeAccess, mockServerRequest } = vi.hoisted(() => ({
  mockServeAccess: vi.fn(),
  mockServerRequest: vi.fn(),
}))

vi.mock('../../shared/serveAccess', () => ({
  default: () => mockServeAccess(),
}))

vi.mock('gpApi/server-request', () => ({
  serverRequest: (...args: unknown[]) => mockServerRequest(...args),
}))

vi.mock('helpers/metadataHelper', () => ({ default: () => ({}) }))

vi.mock('../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('../components/IssuesNavHeader', () => ({ default: () => null }))
vi.mock('../components/CommunityIssuesChatDock', () => ({
  default: () => null,
}))
vi.mock('../components/IssueCard', () => ({
  default: ({ issue }: { issue: { title: string } }) => (
    <div data-testid="issue">{issue.title}</div>
  ),
}))

const card = (
  overrides: Partial<CommunityIssueCard> = {},
): CommunityIssueCard => ({
  id: 'issue-1',
  list: 'trending',
  category: 'Housing',
  priority: 'high',
  title: 'An issue',
  summary: 'A summary.',
  rank: null,
  prioritized: false,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockServeAccess.mockResolvedValue(undefined)
})

describe('dashboard/community-issues/trending page', () => {
  it('gates on serveAccess and fetches the trending list', async () => {
    mockServerRequest.mockResolvedValue({ data: { issues: [] } })

    render(await Page())

    expect(mockServeAccess).toHaveBeenCalledOnce()
    expect(mockServerRequest).toHaveBeenCalledWith('GET /v1/community-issues', {
      list: 'trending',
    })
  })

  it('renders the fetched trending issues', async () => {
    mockServerRequest.mockResolvedValue({
      data: {
        issues: [
          card({ id: 'a', title: 'Alpha' }),
          card({ id: 'b', title: 'Beta' }),
        ],
      },
    })

    render(await Page())

    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('propagates a fetch failure instead of swallowing it', async () => {
    mockServerRequest.mockRejectedValue(new Error('api down'))

    await expect(Page()).rejects.toThrow('api down')
  })
})
