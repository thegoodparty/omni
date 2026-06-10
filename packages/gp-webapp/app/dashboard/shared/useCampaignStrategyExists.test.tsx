import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from 'helpers/test-utils/api-mocking'
import { useCampaignStrategyExists } from './useCampaignStrategyExists'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
)

describe('useCampaignStrategyExists', () => {
  it('returns true once the endpoint reports an existing strategy', async () => {
    api.mock('GET /v1/campaignStrategy/mine/exists', {
      status: 200,
      data: { exists: true },
    })

    const { result } = renderHook(() => useCampaignStrategyExists(), {
      wrapper,
    })

    expect(result.current).toBe(false)
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('returns false when no strategy exists', async () => {
    api.mock('GET /v1/campaignStrategy/mine/exists', {
      status: 200,
      data: { exists: false },
    })

    const { result } = renderHook(() => useCampaignStrategyExists(), {
      wrapper,
    })

    await waitFor(() => expect(result.current).toBe(false))
  })

  it('degrades to hidden (false) when the request fails', async () => {
    // exists: true in the error body makes this non-tautological: it only
    // passes if the 500 actually lands the query in error state (data
    // undefined) rather than resolving with the body.
    api.mock('GET /v1/campaignStrategy/mine/exists', {
      status: 500,
      data: { exists: true },
    })

    const { result } = renderHook(() => useCampaignStrategyExists(), {
      wrapper,
    })

    await waitFor(() => expect(result.current).toBe(false))
  })
})
