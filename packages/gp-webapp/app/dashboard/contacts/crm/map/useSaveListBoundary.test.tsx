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

  // The ordering IS the fix. Both drawing surfaces decide whether to offer
  // the draw button from the `custom-segments` cache, so closing before that
  // cache refreshes hands the holder back a card still saying "unlocked" —
  // inviting them to draw on the list they were just refused. Asserted as a
  // sequence because the two calls both happen either way; only their order
  // distinguishes the bug from the fix.
  it('refreshes the list cache before closing the drawer on a 409', async () => {
    const order: string[] = []
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(async () => {
      order.push('invalidate')
    })
    const onSaved = vi.fn(() => {
      order.push('closed')
    })
    const locked = new FetchError('locked')
    locked.status = 409
    mockedRequest.mockRejectedValue(locked)

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
    expect(order).toEqual(['invalidate', 'closed'])
  })
})
