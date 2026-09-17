import { describe, it, expect, vi } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useListRowDetail } from './useListRowDetail'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'campaign-1' }),
}))

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
)

const detailResponse = {
  demographics: {
    people: 250,
    avgAge: 44,
    avgIncome: 60000,
  },
  reachability: {
    sms: 100,
    robocall: 100,
    phoneBanking: 100,
    doorKnocking: 100,
    polls: 100,
  },
  outreachHistory: [],
}

// Waiting on `isGated` would be the wrong anchor even though it currently works:
// isGated is `!enabled`, true synchronously on first render, so waitFor resolves
// on its first check. That check happens to land AFTER the fetch because
// renderHook wraps mount in act() and React Query starts the request in that
// flush — verified by removing the gate and watching this test fail. But relying
// on when act() flushes is fragile, so anchor on an explicit macrotask instead,
// matching the sibling gate tests.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useListRowDetail', () => {
  it('fires no request when disabled', async () => {
    const onRequest = vi.fn()
    api.mock('GET /v1/contacts/list-detail', () => {
      onRequest()
      return { status: 200, data: detailResponse }
    })

    const { result } = renderHook(() => useListRowDetail(42, false), {
      wrapper,
    })
    await flush()

    expect(result.current.isGated).toBe(true)
    expect(onRequest).not.toHaveBeenCalled()
    expect(result.current.peopleCount).toBeUndefined()
  })

  // The regression this guards: without a cap, ListsIndex mounts one hook per
  // saved list and they all fire together - 19 lists meant 19 requests and ~76
  // people-db aggregates at once, which is what 504'd in prod. Assert on peak
  // CONCURRENCY, not total calls: all 19 must still complete, just never more
  // than MAX_IN_FLIGHT at a time.
  it('never has more than 3 row fetches in flight at once', async () => {
    let inFlight = 0
    let peak = 0
    let completed = 0
    const release: Array<() => void> = []

    api.mock('GET /v1/contacts/list-detail', () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      return new Promise((resolve) => {
        release.push(() => {
          inFlight -= 1
          completed += 1
          resolve({ status: 200, data: detailResponse })
        })
      })
    })

    const segments = Array.from({ length: 19 }, (_, i) => 1000 + i)
    for (const id of segments) {
      renderHook(() => useListRowDetail(id, true), { wrapper })
    }
    await flush()

    // Nothing has resolved yet, so this is the true peak.
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(0)

    // Drain: each release lets a queued row through, so all 19 still finish.
    for (let i = 0; i < segments.length; i += 1) {
      release[i]?.()
      await flush()
    }
    await waitFor(() => expect(completed).toBe(segments.length))
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('fires the request when enabled', async () => {
    const onRequest = vi.fn()
    api.mock('GET /v1/contacts/list-detail', () => {
      onRequest()
      return { status: 200, data: detailResponse }
    })

    const { result } = renderHook(() => useListRowDetail(43, true), {
      wrapper,
    })

    await waitFor(() => expect(result.current.peopleCount).toBe(250))
    expect(onRequest).toHaveBeenCalledTimes(1)
    expect(result.current.isGated).toBe(false)
  })
})
