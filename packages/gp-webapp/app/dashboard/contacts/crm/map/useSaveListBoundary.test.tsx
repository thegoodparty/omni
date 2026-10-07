import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { FetchError } from 'ofetch'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { clientRequest } from 'gpApi/typed-request'
import { useSaveListBoundary } from './useSaveListBoundary'
import type { ListShape } from 'app/dashboard/shared/listShapes'

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

const SHAPE: ListShape = {
  name: 'Downtown',
  color: '#2563eb',
  ring: [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
}

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
      const onClose = vi.fn(() => {
        order.push('closed')
      })
      const onSaved = vi.fn()
      if (status === undefined) {
        mockedRequest.mockResolvedValue({ data: { id: 7 } } as never)
      } else {
        const failure = new FetchError('locked')
        failure.status = status
        mockedRequest.mockRejectedValue(failure)
      }

      const { result } = renderHook(
        () => useSaveListBoundary(7, 'chat', { onClose, onSaved }),
        {
          wrapper: ({ children }) => (
            <QueryClientProvider client={queryClient}>
              {children}
            </QueryClientProvider>
          ),
        },
      )

      result.current.mutate([SHAPE])

      await waitFor(() => expect(onClose).toHaveBeenCalled())
      // Closing is last whatever happened; how many caches were refreshed
      // first differs between the paths and is not what this pins.
      expect(order[order.length - 1]).toBe('closed')
      expect(
        order.filter((step) => step === 'invalidate').length,
      ).toBeGreaterThan(0)
      expect(order.indexOf('closed')).toBe(order.length - 1)
      // The 409 closes the surface too, so a chat announcing the save off
      // `onClose` would announce a write the lock refused.
      expect(onSaved).toHaveBeenCalledTimes(status === undefined ? 1 : 0)
    },
  )

  // The chat's turn says one of two things and the shapes are the only thing
  // that decides which, so the flag has to come off the same write the
  // event reads rather than off the caller's own idea of what it sent.
  it.each([
    ['a drawn shape', [SHAPE], false],
    ['a cleared boundary', [], true],
  ])('reports %s to onSaved', async (_label, shapes, cleared) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const onSaved = vi.fn()
    mockedRequest.mockResolvedValue({ data: { id: 7 } } as never)

    const { result } = renderHook(
      () => useSaveListBoundary(7, 'chat', { onSaved }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      },
    )

    result.current.mutate(shapes)

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ cleared }))
  })

  // The names ride beside the geometry, one per part in the same order, or
  // gp-api has nothing to call the shapes by when the list reopens.
  it("sends each shape's name and colour beside the boundary", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    mockedRequest.mockResolvedValue({ data: { id: 7 } } as never)

    const { result } = renderHook(() => useSaveListBoundary(7, 'chat'), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    })

    result.current.mutate([SHAPE])

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        'PUT /v1/voters/voter-file/filter/:id',
        expect.objectContaining({
          id: '7',
          geoPoly: expect.objectContaining({ type: 'Polygon' }),
          geoPolyLabels: [{ name: 'Downtown', color: '#2563eb' }],
        }),
      ),
    )
  })
})
