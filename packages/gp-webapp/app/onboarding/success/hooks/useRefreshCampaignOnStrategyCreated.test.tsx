import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { useRefreshCampaignOnStrategyCreated } from './useRefreshCampaignOnStrategyCreated'

const setup = (initialRowExists: boolean) => {
  const queryClient = new QueryClient()
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { rerender } = renderHook(
    ({ rowExists }) => useRefreshCampaignOnStrategyCreated(rowExists),
    { initialProps: { rowExists: initialRowExists }, wrapper },
  )
  return { invalidateSpy, rerender }
}

describe('useRefreshCampaignOnStrategyCreated', () => {
  it('does not invalidate while the strategy row does not exist', () => {
    const { invalidateSpy, rerender } = setup(false)

    rerender({ rowExists: false })

    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('invalidates the campaign query once the row exists', () => {
    const { invalidateSpy, rerender } = setup(false)

    rerender({ rowExists: true })

    expect(invalidateSpy).toHaveBeenCalledExactlyOnceWith({
      queryKey: CAMPAIGN_QUERY_KEY,
    })
  })

  it('invalidates only once across later re-renders', () => {
    const { invalidateSpy, rerender } = setup(true)

    rerender({ rowExists: true })
    rerender({ rowExists: false })
    rerender({ rowExists: true })

    expect(invalidateSpy).toHaveBeenCalledTimes(1)
  })
})
