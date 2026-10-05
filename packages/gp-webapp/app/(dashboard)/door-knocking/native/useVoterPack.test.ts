import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GATEWAY_IDLE_TIMEOUT_MS,
  PACK_FETCH_TIMEOUT_MS,
  voterPackQueryOptions,
} from './useVoterPack'

const callQueryFn = () => {
  const { queryFn } = voterPackQueryOptions
  if (typeof queryFn !== 'function') throw new Error('no queryFn')
  // The pack query takes no context off the QueryFunctionContext, so calling
  // it directly is enough to observe the request it makes.
  return queryFn({} as Parameters<typeof queryFn>[0])
}

describe('voterPackQueryOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // A pack request the gateway has already killed leaves the browser waiting
  // on a socket with nobody on the other end. The client needs its own
  // deadline, and it has to expire first or it never fires.
  it('gives up before the gateway kills the connection', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 503 }))

    await expect(callQueryFn()).rejects.toThrow('503')

    expect(timeout).toHaveBeenCalledWith(PACK_FETCH_TIMEOUT_MS)
    expect(PACK_FETCH_TIMEOUT_MS).toBeLessThan(GATEWAY_IDLE_TIMEOUT_MS)
    const [, init] = fetchSpy.mock.calls[0] ?? []
    expect(init?.signal).toBe(timeout.mock.results[0]?.value)
  })

  // The retry is what turned one visible failure into 165 seconds of spinner
  // in prod on 2026-08-25: abandoning the request does not cancel the scan
  // behind it, so the second attempt competed with the first for the same
  // people-db.
  it('does not retry', () => {
    expect(voterPackQueryOptions.retry).toBe(0)
  })
})
