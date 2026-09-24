// Peerly carries the send window in two places per job: the job's own
// Schedule (allowed sending hours, `POST /schedule`) and the canvasser
// request (`request_canvassers`). Both open at the candidate's chosen
// wall-clock time and close at the fixed 21:00 compliance cutoff, in each
// contact's local timezone, so both read the start from here. The start is
// capped at 20:00 so it can never collapse the window; a missing or
// malformed time keeps the historical 09:00 open. Lexicographic compare is
// safe on zero-padded HH:mm.
export const SEND_WINDOW_START_FLOOR = '09:00'
export const SEND_WINDOW_START_CEILING = '20:00'
export const SEND_WINDOW_END = '21:00'

export const resolveSendWindowStart = (
  time: string | null | undefined,
): string => {
  if (!time || !/^\d{2}:[0-5]\d$/.test(time)) return SEND_WINDOW_START_FLOOR
  if (time < SEND_WINDOW_START_FLOOR) return SEND_WINDOW_START_FLOOR
  if (time > SEND_WINDOW_START_CEILING) return SEND_WINDOW_START_CEILING
  return time
}
