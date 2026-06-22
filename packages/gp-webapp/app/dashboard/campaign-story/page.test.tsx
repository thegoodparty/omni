import { describe, it, expect, vi, beforeEach } from 'vitest'
import Page from './page'

const { mockCandidateAccess, mockServerRequest } = vi.hoisted(() => ({
  mockCandidateAccess: vi.fn(),
  mockServerRequest: vi.fn(),
}))

vi.mock('../shared/candidateAccess', () => ({
  default: () => mockCandidateAccess(),
}))

vi.mock('gpApi/server-request', () => ({
  serverRequest: (...args: unknown[]) => mockServerRequest(...args),
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
})

describe('dashboard/campaign-story page', () => {
  it('threads the fetched story to the page', async () => {
    const story = { why: 'w', background: 'b', issues: 'i' }
    mockServerRequest.mockResolvedValue({ data: story })

    const result = await Page()

    expect(mockServerRequest).toHaveBeenCalledWith(
      'GET /v1/campaigns/mine/story',
      {},
    )
    expect(result.props.initialStory).toEqual(story)
  })

  it('propagates a fetch failure instead of swallowing it', async () => {
    mockServerRequest.mockRejectedValue(new Error('api down'))

    await expect(Page()).rejects.toThrow('api down')
  })
})
