import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { ELIGIBILITY_QUERY_KEY } from '@shared/organization-picker'
import type { Campaign } from 'helpers/types'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import ProUpgradeEntry from './ProUpgradeEntry'

// Mock only useQuery so we control pending vs resolved; keep the real
// QueryClient/QueryClientProvider that the render helper relies on.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQuery: vi.fn() }
})

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
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

// The entry runs two queries (campaign, eligibility). Drive them independently so we can
// exercise their loading/blocked states. Eligibility defaults to an active
// campaign so the pre-existing routing tests exercise the redirect path.
const setQueries = (
  campaign: ReturnType<typeof useQuery>,
  eligibility: ReturnType<typeof useQuery> = queryResult({
    data: { hasActiveCampaign: true },
  }),
): void => {
  mockUseQuery.mockImplementation((options) => {
    const { queryKey } = options as { queryKey: unknown }
    if (queryKey === CAMPAIGN_QUERY_KEY) return campaign
    if (queryKey === ELIGIBILITY_QUERY_KEY) return eligibility
    return queryResult()
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

    // Spinner renders role="status" aria-label="Loading".
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('holds on the spinner until the campaign query resolves', () => {
    // The campaign feeds the isPro derivation. Deriving while it is still
    // loading (campaign null) would mis-route a returning Pro candidate and
    // produce a double-redirect when it later resolves.
    setQueries(queryResult({ isPending: true }))

    render(<ProUpgradeEntry />)

    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('renders nothing once the queries resolve and schedules the redirect', () => {
    setQueries(queryResult())

    const { container } = render(<ProUpgradeEntry />)

    // Not Pro yet → the wizard opens on guidance.
    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByRole('status', { name: /loading/i }),
    ).not.toBeInTheDocument()
    expect(router.replace).toHaveBeenCalledWith(
      '/dashboard/pro-upgrade/guidance',
    )
  })

  it('shows a recoverable error and does not redirect when a query fails', () => {
    // A failed fetch leaves data undefined; redirecting would mis-derive a
    // returning candidate back to the intro as if they had zero progress.
    setQueries(queryResult({ isError: true }))

    render(<ProUpgradeEntry />)

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('shows the recoverable error when only the eligibility query fails', () => {
    setQueries(queryResult(), queryResult({ isError: true }))

    render(<ProUpgradeEntry />)

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('holds on the spinner while the eligibility query is pending', () => {
    setQueries(queryResult(), queryResult({ isPending: true }))

    render(<ProUpgradeEntry />)

    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('blocks entry with an explanation when no campaign is active (ENG-10892)', () => {
    setQueries(
      queryResult({ data: { details: {} } as Campaign }),
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

  describe('Flow Started', () => {
    it('fires once with the attribution the entry link carried', () => {
      vi.mocked(useSearchParams).mockReturnValue(
        new URLSearchParams({
          source: 'navigation',
          channel: 'generic',
          cta: 'Join Pro',
        }) as unknown as ReturnType<typeof useSearchParams>,
      )
      setQueries(queryResult())

      const { rerender } = render(<ProUpgradeEntry />)
      rerender(<ProUpgradeEntry />)

      expect(trackEvent).toHaveBeenCalledTimes(1)
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.ProUpgrade.Compliance.FlowStarted,
        { source: 'navigation', channel: 'generic', cta: 'Join Pro' },
      )
    })

    it('reads a bare entry as direct', () => {
      vi.mocked(useSearchParams).mockReturnValue(
        new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
      )
      setQueries(queryResult())

      render(<ProUpgradeEntry />)

      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.ProUpgrade.Compliance.FlowStarted,
        { source: 'direct', channel: 'generic' },
      )
    })

    it('does not fire for an already-Pro candidate routed to success', () => {
      setQueries(
        queryResult({ data: { isPro: true, details: {} } as Campaign }),
      )

      render(<ProUpgradeEntry />)

      expect(trackEvent).not.toHaveBeenCalled()
    })
  })
})
