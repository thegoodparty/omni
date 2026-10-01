import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'

const clientRequestMock = vi.fn()
const trackEventMock = vi.fn()

vi.mock('gpApi/typed-request', () => ({
  clientRequest: (...args: unknown[]) => clientRequestMock(...args),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ successSnackbar: vi.fn(), errorSnackbar: vi.fn() }),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}))

import { EVENTS } from 'helpers/analyticsHelper'
import { useCampaignLifecycle } from './campaignLifecycle'

const ANCHOR = 900

const turf = (id: number, completed: boolean) => ({
  id,
  name: `Turf ${id}`,
  color: '#22c55e',
  loggedCount: id * 10,
  knockedDoorCount: 1,
  completed,
  archivedAt: null,
})

// A fresh client per test so nothing inherits the previous one's cache — the
// whole point here is which entries are warm.
const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children)
  }

const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

const completedCalls = () =>
  trackEventMock.mock.calls.filter(
    ([name]) => name === EVENTS.Dashboard.VoterContact.CampaignCompleted,
  )

describe('useCampaignLifecycle', () => {
  beforeEach(() => {
    clientRequestMock.mockReset()
    trackEventMock.mockReset()
  })

  // The bug this replaced: the pre-press active set was read out of the cache
  // in `onSuccess`, so a campaign whose drawer had never been opened (or whose
  // entry had been GC'd) fired ZERO completion events, silently.
  it('reports a completion per turf even when the campaign cache is cold', async () => {
    clientRequestMock.mockImplementation((route: string) => {
      if (route === 'GET /v1/door-knocking/campaigns/:anchorId') {
        return Promise.resolve({
          data: [turf(1, false), turf(2, false), turf(3, true)],
        })
      }
      return Promise.resolve({
        data: [turf(1, true), turf(2, true), turf(3, true)],
      })
    })

    const { result } = renderHook(() => useCampaignLifecycle(ANCHOR, false), {
      wrapper: wrapper(newClient()),
    })
    result.current.markDone()

    await waitFor(() => expect(completedCalls()).toHaveLength(2))
    // Turf 3 was already done before the press, so it is not this press's.
    expect(
      completedCalls()
        .map(([, props]) => props.listId)
        .sort(),
    ).toEqual([1, 2])
  })

  // The regression the first fix introduced: awaiting the pre-flight fetch
  // unguarded meant a 5xx on it rejected `mutationFn` BEFORE the complete was
  // sent, so the candidate was told their campaign could not be marked done
  // when the request had never been attempted. A measurement taken on the way
  // to a write must never be able to fail the write.
  it('still marks the campaign done when the pre-flight read fails', async () => {
    clientRequestMock.mockImplementation((route: string) => {
      if (route === 'GET /v1/door-knocking/campaigns/:anchorId') {
        return Promise.reject(new Error('502'))
      }
      return Promise.resolve({ data: [turf(1, true)] })
    })

    const { result } = renderHook(() => useCampaignLifecycle(ANCHOR, false), {
      wrapper: wrapper(newClient()),
    })
    result.current.markDone()

    await waitFor(() =>
      expect(
        clientRequestMock.mock.calls.some(
          ([route]) =>
            route === 'POST /v1/door-knocking/campaigns/:anchorId/complete',
        ),
      ).toBe(true),
    )
    // The events are the thing given up, not the press.
    expect(completedCalls()).toHaveLength(0)
  })
})
