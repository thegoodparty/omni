import { queryOptions } from '@tanstack/react-query'
import { decodePack, DecodedPack } from './packDecoder'

// The gateway in front of gp-api kills a request that has produced no bytes
// for this long, and it does so without writing a status — the client is left
// holding a connection nobody is on the other end of. Measured in prod
// 2026-08-25: two pack requests died at exactly 119,999ms.
export const GATEWAY_IDLE_TIMEOUT_MS = 120_000

// Deliberately under the ceiling above, so a stuck pack surfaces as our own
// clean, visible failure rather than as an indefinite wait on a dead socket.
// The slowest pack ever served took 43.5s, so this leaves ample headroom for a
// genuinely slow build.
export const PACK_FETCH_TIMEOUT_MS = 90_000

// Raw fetch, not clientRequest: the pack is a binary ArrayBuffer and
// clientRequest is JSON-only. The /api/v1 middleware rewrite attaches the
// org-slug header from the cookie, same as every other client call.
const fetchPack = async (): Promise<DecodedPack> => {
  const response = await fetch('/api/v1/door-knocking/pack', {
    credentials: 'include',
    signal: AbortSignal.timeout(PACK_FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`pack fetch failed (${response.status})`)
  }
  return decodePack(await response.arrayBuffer())
}

export const voterPackQueryOptions = queryOptions({
  queryKey: ['door-knocking-pack'],
  queryFn: fetchPack,
  // A worst-city pack is tens of MB and tens of seconds — never refetch it
  // behind the user's back within a session.
  staleTime: Infinity,
  gcTime: 10 * 60 * 1000,
  // No retry. This is the single most expensive read the feature has, and
  // abandoning the connection does not cancel the scan behind it, so a retry
  // contends with a build that is still running against the same people-db —
  // it makes the slow case slower. In prod 2026-08-25 the retry is what turned
  // one visible failure into 165 seconds of spinner.
  retry: 0,
})
