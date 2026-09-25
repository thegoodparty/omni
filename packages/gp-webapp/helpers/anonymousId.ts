// Server-minted visitor id. Set in middleware.ts, read on the client in
// app/shared/utils/analytics.ts to re-seed Segment's anonymous id.
//
// Deliberately not Segment's own `ajs_anonymous_id`: Segment writes that one
// from JS, and Brave and Safari cap the lifetime of any JS-written cookie to
// 7 days. A visitor returning after a week is counted as a brand new anonymous
// user, which silently inflates the top of every pre-signup funnel. This
// cookie only ever arrives via `Set-Cookie` from our own origin, which is
// exempt from that cap.
export const ANONYMOUS_ID_COOKIE = 'gp_aid'

// Segment's own anonymous id cookie, read in middleware.ts.
export const SEGMENT_ANONYMOUS_ID_COOKIE = 'ajs_anonymous_id'

// Adopt the identity Segment already has rather than minting over it. The
// client seeds Segment from ANONYMOUS_ID_COOKIE on load, so handing a
// returning visitor a fresh id would overwrite their established
// `ajs_anonymous_id` and reset them to a new anonymous user — the exact churn
// this cookie exists to prevent, inflicted once on the entire existing
// audience at rollout. Only genuinely new visitors get a new id.
//
// analytics-next writes the cookie unquoted but JSON-encodes the same value in
// localStorage; the trim tolerates a quoted form in case that ever changes.
export const resolveAnonymousId = (segmentAnonymousId?: string): string =>
  segmentAnonymousId?.replace(/^"|"$/g, '').trim() || crypto.randomUUID()
