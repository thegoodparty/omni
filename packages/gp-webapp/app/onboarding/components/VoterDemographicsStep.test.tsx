import { describe, expect, it } from 'vitest'
import { renderHook, screen, waitFor } from '@testing-library/react'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import {
  VoterDemographicsStep,
  onboardingDistrictStatsQueryOptions,
} from './VoterDemographicsStep'

const statsResponse = {
  districtId: 'd-1',
  computedAt: '2026-06-11T00:00:00Z',
  totalConstituents: 1000,
  totalConstituentsWithCellPhone: 600,
  buckets: {
    age: [],
    homeowner: [],
    education: [],
    presenceOfChildren: [],
    estimatedIncomeRange: [],
  },
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
)

describe('onboardingDistrictStatsQueryOptions', () => {
  it('fires a param-less request when only the org position is known', async () => {
    // Post-race-edit state: the snapshot BR position id is gone, but the
    // org pointer exists — gp-api derives the district server-side.
    api.mock('GET /v1/onboarding/contacts/stats', {
      status: 200,
      data: statsResponse,
    })

    const { result } = renderHook(
      () =>
        useQuery(
          onboardingDistrictStatsQueryOptions({ orgPositionId: 'gp-uuid-1' }),
        ),
      { wrapper },
    )

    await waitFor(() => expect(result.current.data).toEqual(statsResponse))
  })

  it('prefers server-side derivation over a provided BR position id', async () => {
    // Post-race-edit, the BR id is the stale onboarding snapshot riding
    // along for cache-key alignment — the request must NOT send it when
    // the org pointer can derive the district server-side.
    let capturedQuery: Record<string, unknown> | undefined
    api.mock('GET /v1/onboarding/contacts/stats', (req) => {
      capturedQuery = req.query as unknown as Record<string, unknown>
      return { status: 200, data: statsResponse }
    })

    const { result } = renderHook(
      () =>
        useQuery(
          onboardingDistrictStatsQueryOptions({
            ballotReadyPositionId: 'br-stale-snapshot',
            orgPositionId: 'gp-uuid-1',
          }),
        ),
      { wrapper },
    )

    await waitFor(() => expect(result.current.data).toEqual(statsResponse))
    expect(capturedQuery?.ballotReadyPositionId).toBeUndefined()
  })

  it('stays disabled when no identifier is available', () => {
    // Manual-office campaigns have neither a BR position id nor an org
    // position — firing would be a guaranteed 400.
    const { result } = renderHook(
      () => useQuery(onboardingDistrictStatsQueryOptions({})),
      { wrapper },
    )

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isLoading).toBe(false)
  })

  it('keys the cache by the org position so a race edit refetches', () => {
    const before = onboardingDistrictStatsQueryOptions({
      orgPositionId: 'gp-uuid-old',
    })
    const after = onboardingDistrictStatsQueryOptions({
      orgPositionId: 'gp-uuid-new',
    })

    expect(before.queryKey).not.toEqual(after.queryKey)
  })
})

describe('VoterDemographicsStep copy overrides', () => {
  it('uses the default candidate ("voter") wording when no overrides are supplied', async () => {
    // Locks the Win-flow defaults: the serve overrides must be opt-in so this
    // shared step is unaffected at every existing candidate call site.
    api.mock('GET /v1/onboarding/contacts/stats', {
      status: 200,
      data: statsResponse,
    })
    api.mock('GET /v1/onboarding/voter-issues', {
      status: 200,
      data: {
        issues: [{ label: 'Public Safety', score: 80, priority: 'high' }],
      },
    })

    render(
      <VoterDemographicsStep
        ballotReadyPositionId="br-1"
        office="Mayor"
        showLocalNewsSources={false}
      />,
    )

    expect(await screen.findByText('Voter Demographics')).toBeInTheDocument()
    expect(screen.getByText('Total Voters')).toBeInTheDocument()
    expect(
      await screen.findByText('Top issues for your voters'),
    ).toBeInTheDocument()
  })

  it('forwards constituent copy overrides through to the demographics and issues sections', async () => {
    // The serve flow's constituent wording must reach both the local headings
    // here and the nested TopVoterIssuesSection. Guards the full prop-forwarding
    // path the serve flow depends on.
    api.mock('GET /v1/onboarding/contacts/stats', {
      status: 200,
      data: statsResponse,
    })
    api.mock('GET /v1/onboarding/voter-issues', {
      status: 200,
      data: {
        issues: [{ label: 'Public Safety', score: 80, priority: 'high' }],
      },
    })

    render(
      <VoterDemographicsStep
        ballotReadyPositionId="br-1"
        office="Mayor"
        showLocalNewsSources={false}
        demographicsHeading="Constituent Demographics"
        totalLabel="Total Constituents"
        ageDistributionDescription="We'll help you tailor your outreach mix to each age group — leaning into SMS and social for younger constituents, and prioritizing mail and door-knocks for older ones."
        topIssuesHeading="Top issues for your constituents"
        topIssuesDescription="The issues constituents in your district care about most right now."
      />,
    )

    expect(
      await screen.findByText('Constituent Demographics'),
    ).toBeInTheDocument()
    expect(screen.getByText('Total Constituents')).toBeInTheDocument()
    expect(
      screen.getByText(
        "We'll help you tailor your outreach mix to each age group — leaning into SMS and social for younger constituents, and prioritizing mail and door-knocks for older ones.",
      ),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('Top issues for your constituents'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Voter Demographics')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Top issues for your voters'),
    ).not.toBeInTheDocument()
  })
})
