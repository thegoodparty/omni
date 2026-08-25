import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { useQuery } from '@tanstack/react-query'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { ELIGIBILITY_QUERY_KEY } from '@shared/organization-picker'
import type { Campaign } from 'helpers/types'
import ProUpgradeEntry from './ProUpgradeEntry'

// Mock only useQuery so we control pending vs resolved; keep the real
// QueryClient/QueryClientProvider that the render helper relies on.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQuery: vi.fn() }
})

const mockUseQuery = vi.mocked(useQuery)

const queryResult = (
  overrides: { data?: unknown; isPending?: boolean; isError?: boolean } = {},
): ReturnType<typeof useQuery> =>
  ({
    data: overrides.data ?? null,
    isPending: overrides.isPending ?? false,
    isError: overrides.isError ?? false,
    refetch: vi.fn(),
  }) as unknown as ReturnType<typeof useQuery>

// The entry runs four queries (campaign, website, TCR, eligibility). Drive the
// campaign and eligibility queries independently from the other two so we can
// exercise their loading/blocked states. Eligibility defaults to an active
// campaign so the pre-existing routing tests exercise the redirect path.
const setQueries = (
  campaign: ReturnType<typeof useQuery>,
  other: ReturnType<typeof useQuery>,
  eligibility: ReturnType<typeof useQuery> = queryResult({
    data: { hasActiveCampaign: true },
  }),
): void => {
  mockUseQuery.mockImplementation((options) => {
    const { queryKey } = options as { queryKey: unknown }
    if (queryKey === CAMPAIGN_QUERY_KEY) return campaign
    if (queryKey === ELIGIBILITY_QUERY_KEY) return eligibility
    return other
  })
}

describe('ProUpgradeEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a spinner and does not redirect while the queries are pending', () => {
    setQueries(
      queryResult({ isPending: true }),
      queryResult({ isPending: true }),
    )

    render(<ProUpgradeEntry />)

    // LoadingAnimation renders a "POWERED BY" marker.
    expect(screen.getByText(/powered by/i)).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('holds on the spinner until the campaign query resolves, even if website/TCR are ready', () => {
    // The campaign feeds isPro / EIN / filing-status derivation. Deriving while
    // it is still loading (campaign null) would mis-route a returning candidate
    // and produce a double-redirect when it later resolves.
    setQueries(queryResult({ isPending: true }), queryResult())

    render(<ProUpgradeEntry />)

    expect(screen.getByText(/powered by/i)).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('renders nothing once the queries resolve and schedules the redirect', () => {
    setQueries(queryResult(), queryResult())

    const { container } = render(<ProUpgradeEntry />)

    // No canonical state → first incomplete step is the value-prop intro.
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(/powered by/i)).not.toBeInTheDocument()
    expect(router.replace).toHaveBeenCalledWith(
      '/dashboard/pro-upgrade/value-prop',
    )
  })

  it('respects a persisted "already filed" answer and does not redirect back to the filing-status step', () => {
    // A returning candidate who answered "yes" maps to has-filed, so the
    // router skips the status step. With no EIN yet, the first incomplete step
    // is EIN — never the value-prop intro or a re-ask of the filing question.
    setQueries(
      queryResult({ data: { details: { hasFiledForRace: true } } as Campaign }),
      queryResult(),
    )

    render(<ProUpgradeEntry />)

    expect(router.replace).toHaveBeenCalledWith('/dashboard/pro-upgrade/ein')
  })

  it('restarts a returning "not filed" candidate at the value-prop intro, not the not-eligible dead-end (ENG-10372)', () => {
    // Previously a persisted "no, not yet" answer routed every re-entry to the
    // filing-instructions ("not eligible") dead-end. With no real progress the
    // candidate must land on the value prop to begin the flow again.
    setQueries(
      queryResult({
        data: { details: { hasFiledForRace: false } } as Campaign,
      }),
      queryResult(),
    )

    render(<ProUpgradeEntry />)

    expect(router.replace).toHaveBeenCalledWith(
      '/dashboard/pro-upgrade/value-prop',
    )
    expect(router.replace).not.toHaveBeenCalledWith(
      '/dashboard/pro-upgrade/filing-instructions',
    )
  })

  it('routes a persisted placeholder EIN to the EIN step instead of past it', () => {
    // Older surfaces shape-check only, so a placeholder EIN can be on file.
    // Presence-based derivation would skip the EIN step and strand the
    // candidate on filing-details, which rejects the EIN it never displays.
    setQueries(
      queryResult({
        data: {
          details: { hasFiledForRace: true, einNumber: '00-0000000' },
        } as Campaign,
      }),
      queryResult(),
    )

    render(<ProUpgradeEntry />)

    expect(router.replace).toHaveBeenCalledWith('/dashboard/pro-upgrade/ein')
  })

  it('shows a recoverable error and does not redirect when a query fails', () => {
    // A failed fetch leaves data undefined; redirecting would mis-derive a
    // returning candidate back to the intro as if they had zero progress.
    setQueries(queryResult({ isError: true }), queryResult())

    render(<ProUpgradeEntry />)

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('shows the recoverable error when only the eligibility query fails', () => {
    setQueries(queryResult(), queryResult(), queryResult({ isError: true }))

    render(<ProUpgradeEntry />)

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('holds on the spinner while the eligibility query is pending', () => {
    setQueries(queryResult(), queryResult(), queryResult({ isPending: true }))

    render(<ProUpgradeEntry />)

    expect(screen.getByText(/powered by/i)).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('blocks entry with an explanation when no campaign is active (ENG-10892)', () => {
    setQueries(
      queryResult({ data: { details: {} } as Campaign }),
      queryResult(),
      queryResult({ data: { hasActiveCampaign: false } }),
    )

    render(<ProUpgradeEntry />)

    expect(
      screen.getByText(/pro requires an active campaign/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /contact support/i }),
    ).toHaveAttribute(
      'href',
      expect.stringContaining('mailto:campaignsuccess@goodparty.org'),
    )
    expect(
      screen.getByRole('link', { name: /back to dashboard/i }),
    ).toHaveAttribute('href', '/dashboard')
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('still routes an already-Pro user to the success surface even with no active campaign', () => {
    // An already-Pro user has nothing left to buy; the blocked screen would be
    // a dead end over their post-payment surface.
    setQueries(
      queryResult({ data: { isPro: true, details: {} } as Campaign }),
      queryResult(),
      queryResult({ data: { hasActiveCampaign: false } }),
    )

    render(<ProUpgradeEntry />)

    expect(
      screen.queryByText(/pro requires an active campaign/i),
    ).not.toBeInTheDocument()
    expect(router.replace).toHaveBeenCalledWith(
      '/dashboard/pro-upgrade/success',
    )
  })
})
