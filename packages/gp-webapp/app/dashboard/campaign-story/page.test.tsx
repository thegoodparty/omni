import { describe, it, expect, vi, beforeEach } from 'vitest'
import Page from './page'

const { mockCandidateAccess, mockServerRequest, mockFetchUserWebsite } =
  vi.hoisted(() => ({
    mockCandidateAccess: vi.fn(),
    mockServerRequest: vi.fn(),
    mockFetchUserWebsite: vi.fn(),
  }))

vi.mock('../shared/candidateAccess', () => ({
  default: () => mockCandidateAccess(),
}))

vi.mock('gpApi/server-request', () => ({
  serverRequest: (...args: unknown[]) => mockServerRequest(...args),
}))

vi.mock('helpers/fetchUserWebsite', () => ({
  fetchUserWebsite: () => mockFetchUserWebsite(),
}))

vi.mock('./components/CampaignStoryPage', () => ({
  default: () => null,
}))

vi.mock('helpers/metadataHelper', () => ({
  default: () => ({}),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockCandidateAccess.mockResolvedValue(undefined)
  mockFetchUserWebsite.mockResolvedValue(null)
})

describe('dashboard/campaign-story page', () => {
  it('threads the fetched story and website why + issues to the page', async () => {
    const story = { background: 'b' }
    mockServerRequest.mockResolvedValue({ data: story })
    mockFetchUserWebsite.mockResolvedValue({
      content: {
        about: {
          bio: '<p>My why</p>',
          issues: [{ title: 'Roads', description: '<p>Fix</p>' }],
        },
      },
    })

    const result = await Page()

    expect(mockServerRequest).toHaveBeenCalledWith(
      'GET /v1/campaigns/mine/story',
      {},
    )
    expect(result.props.initialStory).toEqual(story)
    expect(result.props.initialBio).toBe('<p>My why</p>')
    expect(result.props.initialIssues).toEqual([
      { title: 'Roads', description: '<p>Fix</p>' },
    ])
  })

  it('passes an empty why and issues when the candidate has no website yet', async () => {
    mockServerRequest.mockResolvedValue({ data: { background: 'b' } })
    mockFetchUserWebsite.mockResolvedValue(null)

    const result = await Page()

    expect(result.props.initialBio).toBe('')
    expect(result.props.initialIssues).toEqual([])
  })

  it('propagates a fetch failure instead of swallowing it', async () => {
    mockServerRequest.mockRejectedValue(new Error('api down'))

    await expect(Page()).rejects.toThrow('api down')
  })
})
