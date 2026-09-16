import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from 'helpers/test-utils/api-mocking'
import { usePrecinctOptions } from './usePrecinctOptions'

// What `isLoading` is allowed to mean.
//
// Every caller pipes this straight into PrecinctFilter, whose first branch is
// a wall of skeletons — so a hook that says "loading" when nothing is on the
// wire renders a precinct group that spins forever, with no error and no
// retry. That reads as a broken filter rather than as an unavailable one, and
// it is reachable on two surfaces: the gates disable the FETCH, but neither
// the CRM wizard's conditions step nor door knocking's who step stops
// rendering, so both can show the control with its query shut off.
//
// The gates themselves are not the bug and must not be loosened to fix it —
// see usePrecinctOptions.gating.test.ts for the 29% error rate an ungated
// fetch produced. The hook just has to report a shut gate as "not loading"
// rather than as "not loaded yet".

const mockOrganization = vi.fn<() => { slug: string } | undefined>(() => ({
  slug: 'campaign-1',
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockOrganization(),
}))

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
)

const precinct = { county: 'SANGAMON', precinct: '14', voters: 900 }

beforeEach(() => {
  mockOrganization.mockReturnValue({ slug: 'campaign-1' })
})

describe('usePrecinctOptions', () => {
  // The bug. A react-query v5 query held back by `enabled` reports
  // `isPending: true` with `fetchStatus: 'idle'` — pending is its status
  // before a first success, not evidence that a request exists.
  it('does not report loading while its gate is shut', () => {
    const { result } = renderHook(() => usePrecinctOptions(false), { wrapper })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.options).toEqual([])
  })

  // The hook's own half of the gate, invisible to callers: an org that has not
  // resolved holds the query back exactly the same way, so it has to answer
  // the same way.
  it('does not report loading before an organization resolves', () => {
    mockOrganization.mockReturnValue(undefined)

    const { result } = renderHook(() => usePrecinctOptions(true), { wrapper })

    expect(result.current.isLoading).toBe(false)
  })

  it('reports loading while the list is in flight, then the options', async () => {
    api.mock('GET /v1/contacts/precincts', {
      status: 200,
      data: { options: [precinct], truncated: false },
    })

    const { result } = renderHook(() => usePrecinctOptions(true), { wrapper })

    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.options).toEqual([precinct]))
    expect(result.current.isLoading).toBe(false)
  })

  // The skeletons are the only feedback that Try again did anything — the
  // error branch renders no spinner of its own. This survives narrowing
  // `isLoading` only because refetching an errored query holding no data
  // resets its status to pending; it is not self-evident from the flag names,
  // which is why it is pinned rather than reasoned about.
  it('reports loading again while a failed list is retried', async () => {
    // Held open rather than answered immediately: the window this asserts on
    // is the retry being in flight, and an instant mock closes it before
    // waitFor can look.
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    // Persistent rather than an ordered list: `retry: 1` plus react-query's
    // refetch-on-mount makes the number of attempts before the error settles
    // an implementation detail, and a counted list runs out mid-way.
    api.mock('GET /v1/contacts/precincts', { status: 500, data: {} })

    const { result } = renderHook(() => usePrecinctOptions(true), { wrapper })

    // Generous: `retry: 1` puts react-query's ~1s backoff between the two
    // failures, which is the default waitFor timeout exactly.
    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 5000,
    })
    expect(result.current.isLoading).toBe(false)

    api.mock('GET /v1/contacts/precincts', async () => {
      await held
      return {
        status: 200 as const,
        data: { options: [precinct], truncated: false },
      }
    })
    result.current.refetch()

    await waitFor(() => expect(result.current.isLoading).toBe(true))
    release()
    await waitFor(() => expect(result.current.options).toEqual([precinct]))
  })
})
