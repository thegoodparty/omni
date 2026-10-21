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
  it('hands the router the user and nothing else', async () => {
    const result = await Page()

    expect(result.props.initialUser).toBe(mockUser)
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  // The existence check only ever decided whether to show a generate button.
  // Nothing generates on demand now, so asking cost every plan-tab load a
  // blocking round trip to decide something it no longer decides.
  it('does not ask whether a plan exists', async () => {
    await Page()

    expect(mockServerRequest).not.toHaveBeenCalled()
  })
})
