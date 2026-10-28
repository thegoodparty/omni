// A hold is placed this many days before the send. The shortest card window
// is Visa's off-session 4 days 18 hours, which fits this plus the margin.
export const HOLD_PLACEMENT_LEAD_DAYS = 3

// Time after the send for the channel to drain and capture.
export const HOLD_SETTLE_MARGIN_HOURS = 24

// A placing or capturing claim older than this is taken over by recovery.
// Stripe's own request timeout is 80 seconds, so a claim this old has no
// request still in flight.
export const HOLD_CLAIM_STALE_MINUTES = 10

// How long before a hold's capture deadline the expiry guard settles it.
export const HOLD_EXPIRY_GUARD_HOURS = 12

// A hold still not placed this close to its send is alerted on.
export const HOLD_UNPLACED_ALERT_HOURS = 24

// Why a hold was voided outside a clean release. The reconcile sweep re-voids
// any of these Stripe has not confirmed canceled.
export type OrphanedHoldReason = 'window_fit' | 'lost_commit' | 'release_failed'
