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
  list: 'top_community',
  category: 'Housing',
  priority: 'high',
  title: 'An issue',
  summary: 'A summary.',
  rank: 1,
  prioritized: false,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockServeAccess.mockResolvedValue(undefined)
})

describe('dashboard/community-issues/all page', () => {
  it('gates on serveAccess and fetches the top_community list', async () => {
    mockServerRequest.mockResolvedValue({ data: { issues: [] } })

    render(await Page())

    expect(mockServeAccess).toHaveBeenCalledOnce()
    expect(mockServerRequest).toHaveBeenCalledWith('GET /v1/community-issues', {
      list: 'top_community',
    })
  })

  it('renders ranked issues sorted by rank and drops the unranked', async () => {
    mockServerRequest.mockResolvedValue({
      data: {
        issues: [
          card({ id: '2', title: 'Second', rank: 2 }),
          card({ id: 'x', title: 'Unranked', rank: null }),
          card({ id: '1', title: 'First', rank: 1 }),
        ],
      },
    })

    render(await Page())

    const titles = screen.getAllByTestId('issue').map((e) => e.textContent)
    expect(titles).toEqual(['First', 'Second'])
  })

  it('propagates a fetch failure instead of swallowing it', async () => {
    mockServerRequest.mockRejectedValue(new Error('api down'))

    await expect(Page()).rejects.toThrow('api down')
  })
})
