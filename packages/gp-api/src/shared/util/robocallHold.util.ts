// Per-run money ceiling for a robocall authorization hold, in cents ($500).
// TESTING safeguard while real runs are validated — no single robocall we place
// a hold for should exceed this. Raise or remove once real runs have validated
// the flow at production volume.
export const ROBOCALL_PER_RUN_CEILING_CENTS = 50000

// How many days ahead of the scheduled send a hold is placed. Must be strictly
// less than Stripe's ~7-day authorization lifetime MINUS the run and the settle
// margin, so a window-edge hold still clears the capture-window-fit check
// (send + ROBOCALL_RUN_HOURS + ROBOCALL_SETTLE_MARGIN_HOURS <= capture_before)
// with slack for capture_before landing slightly under a full 7 days. At 3 days:
// 3d + 48h + 24h = 6d, which fits even a 6-day capture_before. (C3.)
export const ROBOCALL_HOLD_WINDOW_DAYS = 3

// How long after the scheduled send the CallHub run may still be dialing before
// its billable count is final and the hold can be captured.
export const ROBOCALL_RUN_HOURS = 48

// Extra slack past the run so the completion sweep + capture have room before
// the hold's capture deadline. send + run + margin must fit inside the hold's
// capture_before, or the hold is unusable and is voided at placement.
export const ROBOCALL_SETTLE_MARGIN_HOURS = 24
