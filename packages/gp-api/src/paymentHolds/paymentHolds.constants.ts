// A hold is placed this many days before the send. The shortest card window
// is Visa's off-session 4 days 18 hours, which fits this plus the margin.
export const HOLD_PLACEMENT_LEAD_DAYS = 3

// Time after the send for the channel to drain and capture.
export const HOLD_SETTLE_MARGIN_HOURS = 24

// Why a hold was voided outside a clean release. The reconcile sweep re-voids
// any of these Stripe has not confirmed canceled.
export type OrphanedHoldReason = 'window_fit' | 'lost_commit' | 'release_failed'
