import type { PolygonStats } from '../filterEngine'

// Hard cap on stops per turf — anything over this can't route.
export const HARD_STOP_LIMIT = 150

// The one sentence both turf lists print about a turf too big to route.
//
// Shared for the reason `draftCounts` is shared: the drawing panel and the
// draw step describe the same turf, and a correction to this wording must
// not land on one of them only. Returns null rather than false so it drops
// straight into `TurfCard`'s `error` slot beside the other per-card
// problems.
//
// **Absent stats are not over the cap.** A draft with no entry is one the
// pack has not answered for — the audience changed and the cache cleared,
// or the pack is still decoding — and holding a press on an answer nobody
// has yet is worse than letting the server refuse a turf that turns out
// too big. Same fail-open bargain the audience check makes.
export const overStopCap = (stats: PolygonStats | undefined): string | null =>
  stats && stats.stops > HARD_STOP_LIMIT
    ? `Over ${HARD_STOP_LIMIT} stops. Draw this one smaller.`
    : null
