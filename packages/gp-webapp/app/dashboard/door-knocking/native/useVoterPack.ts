import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { decodePack, DecodedPack, type LoggedKnock } from './packDecoder'

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

// What this download costs, said out loud. Prod over 72h: p50 4.5s, p95 33.6s,
// max 57s. It lives here beside the fetch and its timeouts because two surfaces
// say it — the map region and the create flow's sheet, which covers that region
// — and a candidate meeting both must not be told two different things about
// the same wait. `LoadingAnimation`'s bar LOOKS determinate and is a fixed-width
// indeterminate animation, so nothing here may imply progress: a duration is the
// only honest promise this wait can make.
//
// Serve says "constituent map" for the same map: an elected official has no
// election on the calendar and the people on it are already theirs, so the
// word is about who is being represented rather than about a ballot. The
// duration sentence is about the download and is shared unchanged.
export const PACK_LOADING_TITLE = 'Loading your voter map…'
export const SERVE_PACK_LOADING_TITLE = 'Loading your constituent map…'
export const PACK_LOADING_DURATION =
  'Large districts can take up to 30 seconds.'
export const PACK_ERROR_MESSAGE =
  'The voter map could not load. Refresh to try again.'
export const SERVE_PACK_ERROR_MESSAGE =
  'The constituent map could not load. Refresh to try again.'

export const packLoadingTitle = (isServe: boolean): string =>
  isServe ? SERVE_PACK_LOADING_TITLE : PACK_LOADING_TITLE

export const packErrorMessage = (isServe: boolean): string =>
  isServe ? SERVE_PACK_ERROR_MESSAGE : PACK_ERROR_MESSAGE

// A district this org cannot resolve is not a slow pack or a failed one: there
// is no request to wait on and refreshing changes nothing, so it needs its own
// sentence on both surfaces rather than borrowing either of the two above.
export const DISTRICT_UNAVAILABLE_MESSAGE =
  'Voter data is not available for this office yet, so there is no map to ' +
  'draw turfs on. Contact support at help@goodparty.org and our team can ' +
  'set this up for you.'
export const SERVE_DISTRICT_UNAVAILABLE_MESSAGE =
  'Constituent data is not available for this office yet, so there is no map ' +
  'to draw turfs on. Contact support at help@goodparty.org and our team can ' +
  'set this up for you.'

export const districtUnavailableMessage = (isServe: boolean): string =>
  isServe ? SERVE_DISTRICT_UNAVAILABLE_MESSAGE : DISTRICT_UNAVAILABLE_MESSAGE

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
  // Long enough to cover being away from the surface, because the alternative
  // is paying for the district again: this used to be ten minutes, so a
  // candidate who took a phone call between building a list and walking it
  // came back to the same 5-30 second download they had already waited out.
  // The cost of holding it is tens of MB of ArrayBuffer with no observer on
  // it, which is the cheaper side of that trade by a wide margin.
  gcTime: 60 * 60 * 1000,
  // No retry. This is the single most expensive read the feature has, and
  // abandoning the connection does not cancel the scan behind it, so a retry
  // contends with a build that is still running against the same people-db —
  // it makes the slow case slower. In prod 2026-08-25 the retry is what turned
  // one visible failure into 165 seconds of spinner.
  retry: 0,
})

// Doors logged since the pack was built, carried on the cached pack itself.
//
// The cache entry rather than the page's own state, because the page does not
// outlive the gesture that writes this: every exit from a walk is a navigation
// to the hub, so a knock kept in component state would be gone before the
// candidate could come back and look at it — and coming back inside `gcTime`
// serves this same pack. It dies with the pack it corrects, which is right:
// a freshly built one already carries these statuses in its `canvassStatus`
// plane.
export const recordLoggedKnocks = (
  queryClient: QueryClient,
  knocks: readonly LoggedKnock[],
): void => {
  if (knocks.length === 0) return
  queryClient.setQueryData(voterPackQueryOptions.queryKey, (pack) =>
    pack
      ? {
          ...pack,
          loggedKnocks: [...(pack.loggedKnocks ?? []), ...knocks],
        }
      : pack,
  )
}
