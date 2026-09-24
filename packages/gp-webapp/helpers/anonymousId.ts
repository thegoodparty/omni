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
