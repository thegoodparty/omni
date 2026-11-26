// When gp-api starts a meeting briefing by itself: its daily job runs at this
// UTC hour and picks up a meeting that has not started and falls on a
// calendar day at most this many days after the run's own day, both days read
// on the meeting's own clock (its timezone). Serve onboarding reads both to
// say when a first briefing will be ready, so the two can never drift apart.
export const BRIEFING_IMMINENCE_WINDOW_DAYS = 3
export const BRIEFING_DAILY_DISPATCH_HOUR_UTC = 7
