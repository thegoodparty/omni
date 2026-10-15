// The single source of truth for the daily window CallHub dials a robocall in.
// `callhubCampaignService.createVoiceBroadcast` sends these to CallHub as the
// campaign's `schedule` (daily_start_time / daily_stop_time / timezone), and
// CallHub enforces this same window at dial time — so the dial-completion
// estimator walks over these exact bounds. Both import from here so a window
// change can never leave the estimate computing against a stale window.
//
// Central tz is the fallback zone for a contact whose own tz is unknown (CallHub
// applies the window per-contact via use_contact_tz); Central keeps that
// fallback inside legal US calling hours, where UTC would fire it ~1am-1pm
// Eastern (a TCPA violation). The 09:00 floor is stricter than the 8am legal
// floor.
export const SCHEDULE_TZ = 'America/Chicago'
export const DAILY_START_TIME = '09:00'
export const DAILY_STOP_TIME = '21:00'
