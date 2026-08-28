// Per-run money ceiling for a robocall authorization hold, in cents ($500).
// TESTING safeguard while real runs are validated — no single robocall we place
// a hold for should exceed this. Raise or remove once real runs have validated
// the flow at production volume.
export const ROBOCALL_PER_RUN_CEILING_CENTS = 50000

// How many days ahead of the scheduled send a hold is placed. Strictly less than
// Stripe's ~7-day authorization lifetime so a hold placed at the window edge
// still has capture slack before it expires (C3).
export const ROBOCALL_HOLD_WINDOW_DAYS = 5

// How long after the scheduled send the CallHub run may still be dialing before
// its billable count is final and the hold can be captured.
export const ROBOCALL_RUN_HOURS = 48

// Extra slack past the run so the completion sweep + capture have room before
// the hold's capture deadline. send + run + margin must fit inside the hold's
// capture_before, or the hold is unusable and is voided at placement.
export const ROBOCALL_SETTLE_MARGIN_HOURS = 24
