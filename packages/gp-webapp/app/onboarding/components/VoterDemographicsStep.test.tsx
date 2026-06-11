import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import { api } from 'helpers/test-utils/api-mocking'
import { onboardingDistrictStatsQueryOptions } from './VoterDemographicsStep'

const statsResponse = {
  districtId: 'd-1',
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
