import { describe, it, expect, vi, beforeEach } from 'vitest'
import { type ReactNode } from 'react'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import Page from './page'

const {
  mockCandidateAccess,
  mockFetchUserCampaign,
  mockServerRequest,
  mockRedirect,
} = vi.hoisted(() => ({
  mockCandidateAccess: vi.fn(),
  mockFetchUserCampaign: vi.fn(),
  mockServerRequest: vi.fn(),
  mockRedirect: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}))

vi.mock('../../shared/candidateAccess', () => ({
  default: () => mockCandidateAccess(),
}))

vi.mock('app/onboarding/shared/getCampaign', () => ({
  fetchUserCampaign: () => mockFetchUserCampaign(),
}))

vi.mock('gpApi/server-request', () => ({
  serverRequest: (...args: unknown[]) => mockServerRequest(...args),
}))

vi.mock('helpers/metadataHelper', () => ({ default: () => ({}) }))

vi.mock('../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

// The flag guard is a client component that gates on remote flag state; the
// page-composition branch under test is independent of it, so render its
// children directly.
vi.mock('@shared/experiments/FeatureFlagGuard', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

// Exercised by its own suite; stub it so this test isolates the page's isPro
// branch.
vi.mock('../components/OpponentResearch', () => ({
  default: () => <div data-testid="opponent-research" />,
}))

vi.mock('../components/OpponentProLockedView', () => ({
  default: () => <div data-testid="opponent-locked-view" />,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockCandidateAccess.mockResolvedValue(undefined)
})

describe('dashboard/race-opponent/opponents page', () => {
  it('renders the locked upgrade view (not a redirect) for a non-Pro user', async () => {
    mockFetchUserCampaign.mockResolvedValue({ isPro: false, details: {} })

    render(await Page())

    expect(screen.getByTestId('opponent-locked-view')).toBeInTheDocument()
    expect(screen.queryByTestId('opponent-research')).not.toBeInTheDocument()
    expect(mockRedirect).not.toHaveBeenCalled()
    // The non-Pro branch returns before the self-research gate fetch.
    expect(mockServerRequest).not.toHaveBeenCalled()
  })

  it('renders the opponent research surface (past the guard) for a Pro user', async () => {
    mockFetchUserCampaign.mockResolvedValue({ isPro: true, details: {} })
    mockServerRequest.mockImplementation((endpoint: string) => {
      if (
        endpoint === 'GET /v1/campaigns/mine/race-opponent/self-research/status'
      ) {
        return Promise.resolve({ data: { status: 'completed' } })
      }
      if (
        endpoint === 'POST /v1/campaigns/mine/race-opponent/opponents/identify'
      ) {
        return Promise.resolve({ data: { opponentNames: [] } })
      }
      return Promise.resolve({ data: null })
    })

    render(await Page())

    expect(screen.getByTestId('opponent-research')).toBeInTheDocument()
    expect(screen.queryByTestId('opponent-locked-view')).not.toBeInTheDocument()
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
