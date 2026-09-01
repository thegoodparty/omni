export const M2M_TOKEN_PREFIX = 'mt_'

// Every authenticated request verifies its session token through a live Clerk
// call in SessionGuard, so unbounded Clerk latency is unbounded gp-api latency
// on every route. Cap it: a timed-out verification is a 401, not a hang.
// An empty or malformed override parses to 0/NaN, and setTimeout treats both as
// "fire now" — every Clerk call would time out instantly on every route. Only a
// positive finite override wins.
const override = Number(process.env.CLERK_API_TIMEOUT_MS)

export const CLERK_API_TIMEOUT_MS =
  Number.isFinite(override) && override > 0 ? override : 2_000
