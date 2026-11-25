// When gp-api starts a meeting briefing by itself: its daily job runs at this
// UTC hour and picks up a meeting that starts within this many days. Serve
// onboarding reads both to say which day a first briefing will be ready, so
// the two can never drift apart.
export const BRIEFING_IMMINENCE_WINDOW_DAYS = 3
export const BRIEFING_DAILY_DISPATCH_HOUR_UTC = 7
