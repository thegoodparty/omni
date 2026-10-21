import { formatInTimeZone } from 'date-fns-tz'
import { resolveSendWindowTimeZone } from '@/vendors/peerly/utils/sendWindowTimeZone.util'

// Plain names for the zones the state table can answer with. Anything else
// falls through to its tz-database name.
const ZONE_LABELS: Record<string, string> = {
  'US/Eastern': 'Eastern Time',
  'US/Central': 'Central Time',
  'US/Mountain': 'Mountain Time',
  'US/Pacific': 'Pacific Time',
  'US/Alaska': 'Alaska Time',
  'US/Arizona': 'Arizona Time',
  'US/Hawaii': 'Hawaii Time',
}

const DATE_FORMAT = 'EEEE, MMMM d, yyyy'

// One line telling an assistant what day it is, in the user's own zone. The
// model has no clock, so without it every deadline, countdown and "weeks out"
// figure is reasoned from whatever date the conversation happens to mention.
// The zone comes from the campaign's or office's state through the same
// state-to-zone table the outreach send window uses; the server runs on UTC,
// which is already tomorrow for part of every US evening. Call it on every
// turn: the system prompt is rebuilt per turn and is never part of the stored
// conversation, so the line cannot go stale.
export const todayLine = (
  state: string | null | undefined,
  now: Date = new Date(),
): string => {
  const zone = resolveSendWindowTimeZone(state)
  const label = ZONE_LABELS[zone] ?? zone
  return `Today is ${formatInTimeZone(now, zone, DATE_FORMAT)} (${label}).`
}

// The calendar day in the user's zone, as yyyy-MM-dd. Every count a prompt
// renders against a stored date starts from this day, so a late evening in
// Chicago is not counted as tomorrow by a UTC server and the date line and the
// counts can never disagree about what day it is.
export const localDay = (
  state: string | null | undefined,
  now: Date = new Date(),
): string =>
  formatInTimeZone(now, resolveSendWindowTimeZone(state), 'yyyy-MM-dd')
