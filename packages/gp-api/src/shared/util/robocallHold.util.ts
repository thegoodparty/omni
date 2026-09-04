// Per-run money ceiling for a robocall authorization hold, in cents ($500).
// TESTING safeguard while real runs are validated — no single robocall we place
// a hold for should exceed this. Raise or remove once real runs have validated
// the flow at production volume.
export const ROBOCALL_PER_RUN_CEILING_CENTS = 50000

// How far ahead of now a candidate may schedule a send. Kept in sync with the
// webapp's RobocallFlow (no shared package reaches both gp-api and gp-webapp
// for a single constant this small).
export const ROBOCALL_MAX_SCHEDULE_DAYS = 85

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

// Grace period for a robocall that misses its exact staging window. The staging
// sweep only stages FUTURE sends and the stranded-authorized sweep fails any
// past-due unstaged draft, so a validly-scheduled run whose send passes DURING a
// deploy / process restart / missed staging tick can never stage and is wrongly
// failed. This grace lets staging still pick up (and the stranded sweep leave
// alone) a run up to this many minutes past its send: staging's lower bound and
// the stranded sweep's past-due threshold BOTH pivot on `now - grace`, so a run
// in `[now - grace, now]` is staging-eligible (rescued) and only a run older than
// `now - grace` is stranded-eligible (failed) — one boundary, never both, never
// neither. 30 min absorbs a deploy/restart/missed-cron so a just-late run still
// stages and dials a few minutes late, which is well inside the hold/capture
// window; short enough that a robocall never fires meaningfully late — a longer
// outage correctly falls through to fail + notify. Timing budget: the
// capture-window fit reserves `send + ROBOCALL_RUN_HOURS (48) +
// ROBOCALL_SETTLE_MARGIN_HOURS (24) = 3d` inside a `captureBefore` ~6-7d out, and
// the completion sweep force-settles a run within SETTLE_MARGIN (24h) of its
// captureBefore regardless, so 30 min of dial lateness (dwarfed by that 24h
// safety valve) never threatens captureBefore.
export const ROBOCALL_STAGING_GRACE_MINUTES = 30

// A draft stranded in hold_pending past this window is a crashed placement — a
// process that won the pending_payment -> hold_pending claim but died before the
// commit / decline / revert that moves it back out. No other sweep touches
// hold_pending, so without recovery the draft is stuck AND a hold placed just
// before the crash reserves the candidate's money with nothing to capture or
// void it. Must comfortably exceed a healthy authorizeHold's hold_pending window
// (deriveBillableCount + a card retrieve + the Stripe hold create + commit,
// seconds) AND the recovery sweep interval, so a merely-slow placement is never
// reclaimed underneath itself. Matches the capturing/dialing stale windows.
export const ROBOCALL_HOLD_PENDING_STALE_MINUTES = 15
