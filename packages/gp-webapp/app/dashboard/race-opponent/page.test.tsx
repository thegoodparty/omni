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
  mockFlag,
} = vi.hoisted(() => ({
  mockCandidateAccess: vi.fn(),
  mockFetchUserCampaign: vi.fn(),
  mockServerRequest: vi.fn(),
  mockRedirect: vi.fn(),
  mockFlag: { on: true },
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

// The flag guard is a client component that gates on remote flag state; stub
// it with a switchable gate (mockFlag.on, default on) so flag-on tests render
// its children while the flag-off test can assert the page ships NOTHING —
// heading included — which fails if any feature UI moves outside the guard.
vi.mock('@shared/experiments/FeatureFlagGuard', () => ({
  default: ({ children }: { children: ReactNode }) =>
    mockFlag.on ? <div>{children}</div> : null,
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
  mockFlag.on = true
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
  it('renders the shared styleguide PageHeader as the only h1 on the page', async () => {
    render(await Page())

    expect(
      screen.getByRole('heading', { name: 'Know Your Opponent' }),
    ).toBeInTheDocument()
    // The old feature-local h1 ("Know your opponent") is gone — PageHeader's
    // own h1 is the single heading rendered above the (mocked) page content.
    expect(document.querySelectorAll('h1')).toHaveLength(1)
  })

  it.each([
    ['Pro', true],
    ['non-Pro', false],
  ])(
    'hides the PageHeader below lg on the %s branch so mobile keeps the single top-bar title',
    async (_label, isPro) => {
      mockFetchUserCampaign.mockResolvedValue({ isPro, details: {} })

      render(await Page())

      // On mobile the page title lives in MobileMenuTrigger's top bar (this
      // route's MOBILE_PAGE_TITLES entry in DashboardLayout); without
      // max-lg:hidden the page would stack two title bars with duplicate h1s
      // below the lg breakpoint.
      const pageHeader = document.querySelector('[data-slot="page-header"]')
      expect(pageHeader).not.toBeNull()
      expect(pageHeader).toHaveClass('max-lg:hidden')
    },
  )

  it.each([
    ['Pro', true],
    ['non-Pro', false],
  ])(
    'ships no PageHeader or feature UI on the %s branch when the flag is off',
    async (_label, isPro) => {
      mockFlag.on = false
      mockFetchUserCampaign.mockResolvedValue({ isPro, details: {} })

      render(await Page())

      // The flag gates the ENTIRE surface (ENG-10608 AC): flag-off must leave
      // no trace of the feature in the rendered HTML — the "Know Your Opponent"
      // heading included. This fails if the PageHeader moves outside the guard.
      expect(
        screen.queryByRole('heading', { name: 'Know Your Opponent' }),
      ).not.toBeInTheDocument()
      expect(document.querySelector('[data-slot="page-header"]')).toBeNull()
      expect(screen.queryByTestId('opponent-list')).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('opponent-locked-view'),
      ).not.toBeInTheDocument()
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

  it('renders the locked upgrade view (not a redirect) for a non-Pro user, still under the PageHeader', async () => {
    mockFetchUserCampaign.mockResolvedValue({ isPro: false, details: {} })

    render(await Page())

    expect(
      screen.getByRole('heading', { name: 'Know Your Opponent' }),
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
