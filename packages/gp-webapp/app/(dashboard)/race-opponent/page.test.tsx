import { describe, it, expect, vi, beforeEach } from 'vitest'
import { type ReactNode } from 'react'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { RaceOpponentResponse } from 'gpApi/api-endpoints'
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

vi.mock('../shared/candidateAccess', () => ({
  default: () => mockCandidateAccess(),
}))

vi.mock('app/onboarding/shared/getCampaign', () => ({
  fetchUserCampaign: () => mockFetchUserCampaign(),
}))

vi.mock('gpApi/server-request', () => ({
  serverRequest: (...args: unknown[]) => mockServerRequest(...args),
}))

vi.mock('helpers/metadataHelper', () => ({ default: () => ({}) }))

// The page is a focused page (back arrow and title, no sidebar), opened from
// the Game Plan's "Your opponents" card. The frame has its own suite; the stub
// renders the title so these assertions can find it.
vi.mock('../shared/FocusedPage', () => ({
  FocusedPage: ({
    title,
    children,
  }: {
    title: string
    children: ReactNode
  }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}))

// RaceOpponentList is exercised by its own suite; stub it so this test isolates
// the page's shell composition and the empty-data fallback.
vi.mock('./components/RaceOpponentList', () => ({
  default: ({ initialData }: { initialData: RaceOpponentResponse }) => (
    <div data-testid="opponent-list">{initialData.collectionStatus}</div>
  ),
}))

// The locked upgrade view is a client component with its own suite; stub it so
// the page test asserts only that the non-Pro branch renders it.
vi.mock('./components/OpponentProLockedView', () => ({
  default: () => <div data-testid="opponent-locked-view" />,
}))

const okRaceOpponent: RaceOpponentResponse = {
  collectionStatus: 'completed',
  lastCollectedAt: '2026-06-20T12:00:00.000Z',
  opponents: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCandidateAccess.mockResolvedValue(undefined)
  mockFetchUserCampaign.mockResolvedValue({
    isPro: true,
    details: {
      normalizedOffice: 'State House',
      district: 'District 21',
      electionDate: '2026-06-30',
    },
  })
  mockServerRequest.mockResolvedValue({ ok: true, data: okRaceOpponent })
})

describe('dashboard/race-opponent page', () => {
  it.each([
    ['Pro', true],
    ['non-Pro', false],
  ])(
    'titles the %s page "Your opponents", as its only h1',
    async (_label, isPro) => {
      mockFetchUserCampaign.mockResolvedValue({ isPro, details: {} })

      render(await Page())

      // Named for the Game Plan card it opens from.
      expect(
        screen.getByRole('heading', { name: 'Your opponents' }),
      ).toBeInTheDocument()
      expect(document.querySelectorAll('h1')).toHaveLength(1)
    },
  )

  it('never renders a contrasts section, even when the page has opponent data', async () => {
    render(await Page())

    expect(
      screen.queryByRole('heading', { name: /review your contrasts/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('contrast-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('regenerate')).not.toBeInTheDocument()
    // The page no longer fetches contrasts at all — only the race-opponent GET.
    expect(mockServerRequest).toHaveBeenCalledTimes(1)
    expect(mockServerRequest).toHaveBeenCalledWith(
      'GET /v1/campaigns/mine/race-opponent',
      {},
      { ignoreResponseError: true },
    )
  })

  it('renders the locked upgrade view (not a redirect) for a non-Pro user, under the title', async () => {
    mockFetchUserCampaign.mockResolvedValue({ isPro: false, details: {} })

    render(await Page())

    expect(
      screen.getByRole('heading', { name: 'Your opponents' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('opponent-locked-view')).toBeInTheDocument()
    expect(screen.queryByTestId('opponent-list')).not.toBeInTheDocument()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('falls back to an empty race-opponent shape when that endpoint is not ok', async () => {
    mockServerRequest.mockResolvedValue({
      ok: false,
      data: { error: 'server error' },
    })

    render(await Page())

    // EMPTY_RACE_OPPONENT has collectionStatus 'idle'; the stub echoes it.
    expect(screen.getByTestId('opponent-list')).toHaveTextContent('idle')
  })
})
