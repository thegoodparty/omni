// Peerly documents `requested_timezone` as LOCAL (each contact's own zone)
// or a tz-database name in the "US/Central" form, and the Schedule's
// `schedule_timezone` (api-docs.peerly.com/reference/create-a-new-schedule)
// as LOCAL or one of an enumerated list — every value below is on it.
// Split states map to their predominant zone; anything unmapped (the 'USA'
// didState default, territories) falls back to Eastern.
export const DEFAULT_SEND_WINDOW_TIMEZONE = 'US/Eastern'

const STATE_SEND_WINDOW_TIMEZONES: Record<string, string> = {
  AL: 'US/Central',
  AK: 'US/Alaska',
  AZ: 'US/Arizona',
  AR: 'US/Central',
  CA: 'US/Pacific',
  CO: 'US/Mountain',
  CT: 'US/Eastern',
  DE: 'US/Eastern',
  FL: 'US/Eastern',
  GA: 'US/Eastern',
  HI: 'US/Hawaii',
  ID: 'US/Mountain',
  IL: 'US/Central',
  IN: 'US/Eastern',
  IA: 'US/Central',
  KS: 'US/Central',
  KY: 'US/Eastern',
  LA: 'US/Central',
  ME: 'US/Eastern',
  MD: 'US/Eastern',
  MA: 'US/Eastern',
  MI: 'US/Eastern',
  MN: 'US/Central',
  MS: 'US/Central',
  MO: 'US/Central',
  MT: 'US/Mountain',
  NE: 'US/Central',
  NV: 'US/Pacific',
  NH: 'US/Eastern',
  NJ: 'US/Eastern',
  NM: 'US/Mountain',
  NY: 'US/Eastern',
  NC: 'US/Eastern',
  ND: 'US/Central',
  OH: 'US/Eastern',
  OK: 'US/Central',
  OR: 'US/Pacific',
  PA: 'US/Eastern',
  RI: 'US/Eastern',
  SC: 'US/Eastern',
  SD: 'US/Central',
  TN: 'US/Central',
  TX: 'US/Central',
  UT: 'US/Mountain',
  VT: 'US/Eastern',
  VA: 'US/Eastern',
  WA: 'US/Pacific',
  WV: 'US/Eastern',
  WI: 'US/Central',
  WY: 'US/Mountain',
  DC: 'US/Eastern',
}

export const resolveSendWindowTimeZone = (
  state: string | null | undefined,
): string =>
  (state && STATE_SEND_WINDOW_TIMEZONES[state.trim().toUpperCase()]) ||
  DEFAULT_SEND_WINDOW_TIMEZONE
