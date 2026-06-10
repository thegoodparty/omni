import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign, User } from 'helpers/types'
import Page from './page'

const {
  mockCandidateAccess,
  mockGetServerUser,
  mockFetchUserCampaign,
  mockRedirect,
} = vi.hoisted(() => ({
  mockCandidateAccess: vi.fn(),
  mockGetServerUser: vi.fn(),
  mockFetchUserCampaign: vi.fn(),
  mockRedirect: vi.fn(),
}))

vi.mock('../shared/candidateAccess', () => ({
  default: () => mockCandidateAccess(),
}))

vi.mock('helpers/userServerHelper', () => ({
  getServerUser: () => mockGetServerUser(),
}))

vi.mock('app/onboarding/shared/getCampaign', () => ({
  fetchUserCampaign: () => mockFetchUserCampaign(),
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
const campaignWithStrategy = { id: 1, hasCampaignStrategy: true } as Campaign
const campaignWithoutStrategy = {
  id: 1,
  hasCampaignStrategy: false,
} as Campaign

beforeEach(() => {
  vi.clearAllMocks()
  mockCandidateAccess.mockResolvedValue(undefined)
  mockGetServerUser.mockResolvedValue(mockUser)
  mockRedirect.mockImplementation(() => undefined as never)
})

describe('dashboard/campaign-plan page', () => {
  it('redirects to /dashboard when campaign has no strategy', async () => {
    mockFetchUserCampaign.mockResolvedValue(campaignWithoutStrategy)

    await Page()

    expect(mockRedirect).toHaveBeenCalledWith('/dashboard')
  })

  it('redirects to /dashboard when campaign is null', async () => {
    mockFetchUserCampaign.mockResolvedValue(null)

    await Page()

    expect(mockRedirect).toHaveBeenCalledWith('/dashboard')
  })

  it('does not redirect when campaign has a strategy', async () => {
    mockFetchUserCampaign.mockResolvedValue(campaignWithStrategy)

    await Page()

    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
