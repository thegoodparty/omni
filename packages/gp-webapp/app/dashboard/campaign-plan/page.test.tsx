import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { User } from 'helpers/types'
import Page from './page'

const {
  mockCandidateAccess,
  mockGetServerUser,
  mockServerRequest,
  mockRedirect,
} = vi.hoisted(() => ({
  mockCandidateAccess: vi.fn(),
  mockGetServerUser: vi.fn(),
  mockServerRequest: vi.fn(),
  mockRedirect: vi.fn(),
}))

vi.mock('../shared/candidateAccess', () => ({
  default: () => mockCandidateAccess(),
}))

vi.mock('helpers/userServerHelper', () => ({
  getServerUser: () => mockGetServerUser(),
}))

vi.mock('gpApi/server-request', () => ({
  serverRequest: (...args: unknown[]) => mockServerRequest(...args),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}))

vi.mock('./components/CampaignPlanPage', () => ({
  default: () => null,
}))

vi.mock('helpers/metadataHelper', () => ({
  default: () => ({}),
}))

const mockUser = { id: 1, firstName: 'Test', lastName: 'User' } as User

beforeEach(() => {
  vi.clearAllMocks()
  mockCandidateAccess.mockResolvedValue(undefined)
  mockGetServerUser.mockResolvedValue(mockUser)
  mockRedirect.mockImplementation(() => undefined as never)
})

describe('dashboard/campaign-plan page', () => {
  it('redirects to /dashboard when no strategy exists', async () => {
    mockServerRequest.mockResolvedValue({ data: { exists: false } })

    await Page()

    expect(mockServerRequest).toHaveBeenCalledWith(
      'GET /v1/campaignStrategy/mine/exists',
      {},
    )
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard')
  })

  it('redirects to /dashboard when the existence check fails', async () => {
    mockServerRequest.mockRejectedValue(new Error('api down'))

    await Page()

    expect(mockRedirect).toHaveBeenCalledWith('/dashboard')
  })

  it('does not redirect when a strategy exists', async () => {
    mockServerRequest.mockResolvedValue({ data: { exists: true } })

    await Page()

    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
