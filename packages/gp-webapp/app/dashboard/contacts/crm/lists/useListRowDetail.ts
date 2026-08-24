import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'

// The lists index has no bulk "count + last outreach" endpoint (task-07 only
// shipped the single-list detail shape) — this fetches GET
// /v1/contacts/list-detail per row so the table can show a refreshed people
// count and the most recent outreach entry (outreachHistory[0]) without
// duplicating the aggregate logic gp-api already computes for the detail
// page. This N+1 is NOT acceptable and needs a bulk endpoint: see
// MAX_IN_FLIGHT below for what it cost in production.
// Exported so other callers that need the raw list-detail payload (e.g. the
// robocall audience step's cost-preview fetch, ENG-10764) hit the same call
// site instead of hand-rolling the clientRequest + field access again.
export const fetchListDetail = (segmentId: number) =>
  clientRequest('GET /v1/contacts/list-detail', {
    segment: segmentId,
  }).then((res) => res.data)

// ListsIndex mounts one of these per saved list and React mounts them together,
// so an org with N lists opens the page with N requests in flight — and each
// one costs FOUR people-db aggregates server-side (base + the three
// reachability channels, ContactsService.fetchListDetailAggregates). At 19
// lists that is ~76 concurrent voter-file scans against a 50-connection pool.
// Measured on prod: 10 concurrent list-detail requests ran 12s p50 / 17s p95,
// and 50 ran 28s p50 — past the 25s statement timeout. Every
// GET /v1/contacts/list-detail 504 in prod on 2026-08-19/20 was a single page
// load from a ~19-list org, one failure per distinct segment.
//
// Capping in-flight row fetches trades latency for completion: the last rows
// resolve later, but they resolve. It does NOT make the queries cheap — that
// needs the bulk endpoint above. 3 keeps the whole fan-out (3 requests = 12
// aggregates) inside the range that measured flat.
const MAX_IN_FLIGHT = 3
let inFlight = 0
const waiting: Array<() => void> = []

const acquireSlot = () =>
  new Promise<void>((resolve) => {
    if (inFlight < MAX_IN_FLIGHT) {
      inFlight += 1
      resolve()
      return
    }
    waiting.push(() => {
      inFlight += 1
      resolve()
    })
  })

const releaseSlot = () => {
  inFlight -= 1
  waiting.shift()?.()
}

// Same call as fetchListDetail, but queued through the MAX_IN_FLIGHT throttle so
// callers outside this hook (e.g. the outreach audience step's cost-preview
// fetch) share the cap instead of adding list-detail fan-out invisible to
// `inFlight` — otherwise opening that flow while the lists index is mounted can
// push concurrent people-db aggregates back past the statement timeout above.
export const fetchListDetailThrottled = async (
  segmentId: number,
  signal?: AbortSignal,
) => {
  await acquireSlot()
  try {
    // Queued behind other callers long enough to be dropped (rapid reselection,
    // flow close): don't spend a request + its four people-db aggregates on a
    // result nothing will read (mirrors the queryFn's own abort check below).
    if (signal?.aborted) throw new Error('list-detail request aborted')
    return await fetchListDetail(segmentId)
  } finally {
    releaseSlot()
  }
}

// `enabled` is required, not defaulted: this hook ran unconditionally for every
// saved list, and getListDetail is pro-gated, so a non-pro user 400d once per row
// on mount without touching anything. A default would let that reappear silently.
export const useListRowDetail = (segmentId: number, enabled: boolean) => {
  const orgSlug = useOrganization()?.slug

  const query = useQuery({
    queryKey: ['list-detail', orgSlug, segmentId],
    queryFn: async ({ signal }) => {
      await acquireSlot()
      try {
        // Queued behind other rows long enough for this one to be dropped
        // (navigation, a segment refresh): don't spend a request on a result
        // nothing will read.
        if (signal.aborted) throw new Error('list-detail request aborted')
        return await fetchListDetail(segmentId)
      } finally {
        releaseSlot()
      }
    },
    enabled,
  })

  return {
    peopleCount: query.data?.demographics.people,
    lastOutreach: query.data?.outreachHistory[0],
    isLoading: query.isLoading,
    isError: query.isError,
    // Lets the row distinguish "not allowed to know" from "still loading", so it
    // renders an upsell rather than an em-dash that never resolves.
    isGated: !enabled,
  }
}
