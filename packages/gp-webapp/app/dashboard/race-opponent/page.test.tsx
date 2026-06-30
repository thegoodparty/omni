import { describe, it, expect, vi, beforeEach } from 'vitest'
import { type ReactNode } from 'react'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { ContrastRecord, RaceOpponentResponse } from 'gpApi/api-endpoints'
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

vi.mock('../shared/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

// The flag guard is a client component that gates on remote flag state; the
// page-composition branches under test are independent of it, so render its
// children directly. Its presence is asserted via the real import in page.tsx.
vi.mock('@shared/experiments/FeatureFlagGuard', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

// RaceOpponentList is exercised by its own suite; stub it so this test isolates
// the page's contrast-section gating and the empty-data fallback.
vi.mock('./components/RaceOpponentList', () => ({
  default: ({ initialData }: { initialData: RaceOpponentResponse }) => (
    <div data-testid="opponent-list">{initialData.collectionStatus}</div>
  ),
}))

vi.mock('./components/ContrastList', () => ({
  default: ({ initialContrasts }: { initialContrasts: ContrastRecord[] }) => (
    <div data-testid="contrast-list">{initialContrasts.length}</div>
  ),
}))

vi.mock('./components/RegenerateContrasts', () => ({
  default: () => <div data-testid="regenerate" />,
}))

// The locked upgrade view is a client component with its own suite; stub it so
// the page test asserts only that the non-Pro branch renders it.
vi.mock('./components/OpponentProLockedView', () => ({
  default: () => <div data-testid="opponent-locked-view" />,
}))

const renderableContrast = (
  overrides: Partial<ContrastRecord> = {},
): ContrastRecord => ({
  id: 1,
  opponentFact: 'voted against the housing bill',
  sourceUrl: 'https://ballotpedia.org/finding',
  candidateFact: 'support more housing',
  contrastSentence: 'On Housing, my opponent voted against — I support more.',
  issueTag: 'Housing',
  routing: 'story',
  status: 'cleared',
  editCount: 0,
  findingId: 10,
  routedWebsiteId: null,
  routedOutreachId: null,
  createdAt: '2026-06-20T12:00:00.000Z',
  updatedAt: '2026-06-20T12:00:00.000Z',
  ...overrides,
})

const okRaceOpponent: RaceOpponentResponse = {
  collectionStatus: 'completed',
  lastCollectedAt: '2026-06-20T12:00:00.000Z',
  opponents: [],
}

// serverRequest is called twice in order: race-opponent, then contrasts. Wire
// each call's { ok, data } result so the page's .ok guards branch correctly.
const wireServerRequest = (
  raceOpponent: { ok: boolean; data: unknown },
  contrasts: { ok: boolean; data: unknown },
): void => {
  mockServerRequest.mockImplementation((endpoint: string) => {
    if (endpoint === 'GET /v1/campaigns/mine/race-opponent') {
      return Promise.resolve(raceOpponent)
    }
    return Promise.resolve(contrasts)
  })
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
})

describe('dashboard/race-opponent page', () => {
  it('hides the contrast section when the contrasts endpoint 403s', async () => {
    wireServerRequest(
      { ok: true, data: okRaceOpponent },
      { ok: false, data: { error: 'forbidden' } },
    )

    render(await Page())

    expect(screen.getByTestId('opponent-list')).toBeInTheDocument()
    expect(screen.queryByTestId('contrast-list')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /review your contrasts/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('regenerate')).not.toBeInTheDocument()
  })

  it('hides the contrast section when every contrast is non-renderable', async () => {
    wireServerRequest(
      { ok: true, data: okRaceOpponent },
      {
        ok: true,
        data: { contrasts: [renderableContrast({ sourceUrl: '' })] },
      },
    )

    render(await Page())

    expect(screen.queryByTestId('contrast-list')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /review your contrasts/i }),
    ).not.toBeInTheDocument()
  })

  it('renders the contrast section when at least one contrast is renderable', async () => {
    wireServerRequest(
      { ok: true, data: okRaceOpponent },
      {
        ok: true,
        data: {
          contrasts: [
            renderableContrast(),
            renderableContrast({ id: 2, sourceUrl: '' }),
          ],
        },
      },
    )

    render(await Page())

    expect(
      screen.getByRole('heading', { name: /review your contrasts/i }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('regenerate')).toBeInTheDocument()
    // Only the renderable contrast survives the page-level filter.
    expect(screen.getByTestId('contrast-list')).toHaveTextContent('1')
  })

  it('renders the locked upgrade view (not a redirect) for a non-Pro user', async () => {
    mockFetchUserCampaign.mockResolvedValue({ isPro: false, details: {} })
    wireServerRequest(
      { ok: true, data: okRaceOpponent },
      { ok: false, data: { error: 'forbidden' } },
    )

    render(await Page())

    expect(screen.getByTestId('opponent-locked-view')).toBeInTheDocument()
    expect(screen.queryByTestId('opponent-list')).not.toBeInTheDocument()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('falls back to an empty race-opponent shape when that endpoint is not ok', async () => {
    wireServerRequest(
      { ok: false, data: { error: 'server error' } },
      { ok: false, data: { error: 'forbidden' } },
    )

    render(await Page())

    // EMPTY_RACE_OPPONENT has collectionStatus 'idle'; the stub echoes it.
    expect(screen.getByTestId('opponent-list')).toHaveTextContent('idle')
    expect(screen.queryByTestId('contrast-list')).not.toBeInTheDocument()
  })
})
