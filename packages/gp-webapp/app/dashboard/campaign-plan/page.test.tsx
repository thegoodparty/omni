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

vi.mock('./components/CampaignPlanRouter', () => ({
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
})

describe('dashboard/campaign-plan page', () => {
  it('renders the router with planExists=false when no strategy exists', async () => {
    mockServerRequest.mockResolvedValue({ data: { exists: false } })

    const result = await Page()

    expect(mockServerRequest).toHaveBeenCalledWith(
      'GET /v1/campaignStrategy/mine/exists',
      {},
    )
    expect(result.props.planExists).toBe(false)
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('fails closed to planExists=false when the existence check fails', async () => {
    mockServerRequest.mockRejectedValue(new Error('api down'))

    const result = await Page()

    expect(result.props.planExists).toBe(false)
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('renders the router with planExists=true when a strategy exists', async () => {
    mockServerRequest.mockResolvedValue({ data: { exists: true } })

    const result = await Page()

    expect(result.props.planExists).toBe(true)
    expect(result.props.initialUser).toBe(mockUser)
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
