import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { FetchError } from 'ofetch'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { clientRequest } from 'gpApi/typed-request'
import { useSaveListBoundary } from './useSaveListBoundary'

vi.mock('gpApi/typed-request', () => ({ clientRequest: vi.fn() }))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-council' }),
}))
vi.mock('helpers/analyticsHelper', () => ({
  trackEvent: vi.fn(),
  EVENTS: { ConstituentData: { ListBoundarySaved: 'saved' } },
}))

const mockedRequest = vi.mocked(clientRequest)

const RING: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
]

describe('useSaveListBoundary', () => {
  beforeEach(() => vi.clearAllMocks())

  // Both paths, because they are the same rule and the last review only
  // caught the error one — the success branch had the identical stale-cache
  // race sitting beside it, untested, and survived a round because the test
  // covered the branch that was pointed at rather than the shape of the bug.
  it.each([
    ['success', undefined],
    ['409', 409],
  ])(
    'refreshes every list cache before closing the drawer (%s)',
    async (_label, status) => {
      const order: string[] = []
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(
        async () => {
          order.push('invalidate')
        },
      )
      const onSaved = vi.fn(() => {
        order.push('closed')
      })
      if (status === undefined) {
        mockedRequest.mockResolvedValue({ data: { id: 7 } } as never)
      } else {
        const failure = new FetchError('locked')
        failure.status = status
        mockedRequest.mockRejectedValue(failure)
      }

      const { result } = renderHook(
        () => useSaveListBoundary(7, 'chat', onSaved),
        {
          wrapper: ({ children }) => (
            <QueryClientProvider client={queryClient}>
              {children}
            </QueryClientProvider>
          ),
        },
      )

      result.current.mutate(RING)

      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      // Closing is last whatever happened; how many caches were refreshed
      // first differs between the paths and is not what this pins.
      expect(order[order.length - 1]).toBe('closed')
      expect(
        order.filter((step) => step === 'invalidate').length,
      ).toBeGreaterThan(0)
      expect(order.indexOf('closed')).toBe(order.length - 1)
    },
  )
})
