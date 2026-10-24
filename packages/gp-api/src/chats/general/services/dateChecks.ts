// Finish-time date checks over an assistant reply: arithmetic a regex can
// settle, with no model call. Two readings. A weekday-date pair ("Monday,
// October 13") is wrong when the weekday is not that date's. A day-by-day
// schedule, read from the lines that open with a date, is incomplete when a
// day inside its span has no entry, or has two. Both are what the campaign
// manager produces when it derives a date instead of copying one: a weekday
// a day early, or a day dropped while the weekdays stay consecutive. The
// module takes the reply text and the candidate's local day and nothing
// else, so any chat with a today line can use it. Nothing here edits the
// reply; the only output is what to check.
import {
  addDays,
  differenceInCalendarDays,
  format,
  getDay,
  isValid,
  parseISO,
} from 'date-fns'

// For reading a name back to an index; output goes through date-fns format.
const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]
const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

// Fragments, each with one capture group, combined below in the order
// weekday, month, day, year, so every reader indexes its match the same way.
const MONTH_RE =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|' +
  'aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const WEEKDAY_RE =
  '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|' +
  'thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)'
const DAY_RE = '(\\d{1,2})(?:st|nd|rd|th)?'
// A year this century. "October 12, 1500 doors" carries a count, not a year.
const YEAR_RE = '(?:,?[ \\t]+(20\\d{2}))?'
// What may sit between a weekday and its date, on one line: a comma, a
// colon, a dash of any length, a bracket, spaces. Never a line break, so a
// weekday ending one line is not paired with a date opening the next.
const GAP = '[ \\t,:()\\-–—]{1,6}'

// "Monday, October 13", "Mon., Oct. 13th, 2026", "Monday (October 13)".
const WEEKDAY_FIRST = new RegExp(
  `\\b${WEEKDAY_RE}\\.?${GAP}${MONTH_RE}\\.?[ \\t]+${DAY_RE}${YEAR_RE}\\b`,
  'gi',
)
// "October 13 (Monday)", "October 13, Monday".
const MONTH_FIRST = new RegExp(
  `\\b${MONTH_RE}\\.?[ \\t]+${DAY_RE}${YEAR_RE}${GAP}${WEEKDAY_RE}\\b`,
  'gi',
)
// "Monday 10/13", "Mon 10/13/2026". "Friday 1/2 of voters" is a fraction.
const WEEKDAY_NUMERIC = new RegExp(
  `\\b${WEEKDAY_RE}\\.?${GAP}(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b(?![ \\t]+(?:of|in)\\b)`,
  'gi',
)
// A line that opens with a date, after any markdown, table or "Day N" /
// "Post N" prefix, with or without a weekday in front of the date. Every
// run here is bounded and stays on its line, so a reply made of blank lines
// costs a pass per line and no more.
const HEADING = new RegExp(
  `^[ \\t#*>\\-|_]{0,24}(?:(?:day|post)[ \\t]{0,3}\\d+[ \\t]{0,3}[:\\-–—(|]{0,4}[ \\t]{0,3})?(?:${WEEKDAY_RE}\\.?${GAP})?${MONTH_RE}\\.?[ \\t]+${DAY_RE}${YEAR_RE}\\b`,
  'gim',
)
// After a heading's date: a second date makes it a week header ("October
// 13-19", "October 27 -- November 3", "Tuesday, October 13 - Monday,
// October 19"). A number with a word after it is a count ("October 27 -- 7
// days out", "October 13 -- 3 posts"), a number with a colon after it is a
// time ("October 13 - 9:00 AM"), and a bare number is the end of a range
// only when it is larger than the day (checked by the reader). Groups: 1 a
// weekday, 2 a month, 3 the bare number.
const RANGE_AFTER = new RegExp(
  `^[ \\t]*(?:[-–—]+|to|through)[ \\t]*(?:(?:${WEEKDAY_RE}\\.?${GAP})?${MONTH_RE}\\.?[ \\t]+\\d{1,2}\\b|(\\d{1,2})(?:st|nd|rd|th)?\\b(?![ \\t]*(?::\\d|[a-z])))`,
  'i',
)

// More text than this is not read; a reply that long is not a schedule.
const MAX_TEXT_LENGTH = 50_000

// A schedule is read for coverage only when it is one: this many distinct
// dated headings at least, over a span this long at most, with headings on
// at least this share of the span's days. A plan that posts three days a
// week sits well under the share and is never read as missing days.
const MIN_SCHEDULE_DAYS = 5
const MAX_SCHEDULE_SPAN_DAYS = 60
const MIN_SCHEDULE_DENSITY = 0.8
// A dropped day shows as one or two days heading two entries. When more
// are doubled, the reply holds two schedules or a summary table, and that
// is not a finding.
const MAX_DOUBLED_AS_FINDING = 2

// How many findings the appended line names before "and N more".
const MAX_NAMED_FINDINGS = 4

// The fixed part of the appended line. It lives here and not in the
// guardrail line registry because the rest of the line is computed per
// reply; the registry holds lines matched verbatim.
export const DATE_CHECK_PREFIX =
  'Before you post, check these dates against the calendar: '

const monthIndex = (name: string): number => {
  const key = name.slice(0, 3).toLowerCase()
  return MONTH_NAMES.findIndex((m) => m.startsWith(key)) + 1
}
const weekdayIndex = (name: string): number => {
  const key = name.slice(0, 3).toLowerCase()
  return WEEKDAY_NAMES.findIndex((w) => w.startsWith(key))
}

// A local-midnight Date for a day that exists; February 30 is null.
const dayOf = (year: number, month: number, day: number): Date | null => {
  const d = new Date(year, month - 1, day)
  return d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
    ? d
    : null
}
const isoOf = (d: Date): string => format(d, 'yyyy-MM-dd')
const monthDay = (d: Date): string => format(d, 'MMMM d')
const weekdayName = (index: number): string =>
  format(new Date(2026, 0, 4 + index), 'EEEE')

// The years a date written without one may be in, likeliest first. Up to
// five months ahead or two months back the year is settled. Beyond that it
// is not: written in October, "Tuesday, May 4" may be next year's primary
// or last year's, "the primary was Tuesday, March 3" is last March, and
// "Monday, January 4" is next January. Both adjacent years are then
// allowed, and a weekday is wrong only if it is wrong in both, so the
// day-early error is caught near today and not far from it.
const yearsFor = (month: number, today: Date, written?: string): number[] => {
  if (written) return [Number(written)]
  const year = today.getFullYear()
  const diff = month - (today.getMonth() + 1)
  if (diff >= 6) return [year, year - 1]
  if (diff >= -2) return [year]
  if (diff >= -5) return [year, year + 1]
  return [year + 1, year]
}
const yearFor = (month: number, today: Date, written?: string): number =>
  yearsFor(month, today, written)[0]!
// A two-digit year on a numeric date ("10/26/26") is this century's.
const numericYears = (
  written: string | undefined,
  month: number,
  today: Date,
): number[] =>
  written
    ? [Number(written.length === 2 ? `20${written}` : written)]
    : yearsFor(month, today)

export interface WeekdayPair {
  // The pair as written, e.g. "Saturday, November 1".
  text: string
  date: Date
  stated: number
  actual: number
  wrong: boolean
  index: number
}

// Every weekday-date pair in the text, in order of appearance. Where two
// readings overlap ("October 13 (Tuesday), October 14" reads either as
// "October 13 (Tuesday)" or as "Tuesday), October 14"), the one that starts
// first wins, which is the form the writer committed to first.
export const weekdayPairs = (text: string, today: Date): WeekdayPair[] => {
  const found: WeekdayPair[] = []
  const push = (
    m: RegExpMatchArray,
    weekday: string,
    month: number,
    day: number,
    years: number[],
  ): void => {
    if (month < 1 || month > 12) return
    const dates = years
      .map((year) => dayOf(year, month, day))
      .filter((d): d is Date => d !== null)
    if (dates.length === 0) return
    const stated = weekdayIndex(weekday)
    const date = dates.find((d) => getDay(d) === stated) ?? dates[0]!
    const actual = getDay(date)
    found.push({
      text: m[0],
      date,
      stated,
      actual,
      wrong: stated !== actual,
      index: m.index ?? 0,
    })
  }
  for (const m of text.matchAll(WEEKDAY_FIRST)) {
    // The month "may" in lower case is nearly always the verb.
    if (m[2] === 'may') continue
    const month = monthIndex(m[2] ?? '')
    push(m, m[1] ?? '', month, Number(m[3]), yearsFor(month, today, m[4]))
  }
  for (const m of text.matchAll(MONTH_FIRST)) {
    if (m[1] === 'may') continue
    const month = monthIndex(m[1] ?? '')
    push(m, m[4] ?? '', month, Number(m[2]), yearsFor(month, today, m[3]))
  }
  for (const m of text.matchAll(WEEKDAY_NUMERIC)) {
    const month = Number(m[2])
    push(m, m[1] ?? '', month, Number(m[3]), numericYears(m[4], month, today))
  }
  found.sort((a, b) => a.index - b.index)
  const out: WeekdayPair[] = []
  let end = -1
  for (const p of found) {
    if (p.index < end) continue
    out.push(p)
    end = p.index + p.text.length
  }
  return out
}

interface Heading {
  date: Date
  index: number
}

// The days a schedule's headings date, in order of appearance. A line that
// opens with a date range heads a week, not a day, and is skipped.
const scheduleHeadings = (text: string, today: Date): Heading[] => {
  const out: Heading[] = []
  for (const m of text.matchAll(HEADING)) {
    if (m[2] === 'may') continue
    const month = monthIndex(m[2] ?? '')
    if (month < 1) continue
    const end = (m.index ?? 0) + m[0].length
    const day = Number(m[3])
    const range = RANGE_AFTER.exec(text.slice(end, end + 24))
    if (range && (range[2] || Number(range[3]) > day)) continue
    const date = dayOf(yearFor(month, today, m[4]), month, day)
    if (date) out.push({ date, index: m.index ?? 0 })
  }
  return out
}

export interface Coverage {
  first: Date
  last: Date
  // ISO days inside the span with no heading.
  missing: string[]
  // ISO days heading more than one entry.
  doubled: string[]
}

// Whether the reply's dated headings form a day-by-day schedule, and if so
// which days inside its span have no entry or two. Null when the headings
// are too few, too spread out, or too sparse to be a daily schedule.
export const scheduleCoverage = (
  text: string,
  today: Date,
): Coverage | null => {
  const seen = new Map<string, { date: Date; entries: number }>()
  for (const h of scheduleHeadings(text, today)) {
    const k = isoOf(h.date)
    const s = seen.get(k)
    if (s) s.entries++
    else seen.set(k, { date: h.date, entries: 1 })
  }
  if (seen.size < MIN_SCHEDULE_DAYS) return null
  const days = [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
  const first = days[0]![1].date
  const last = days[days.length - 1]![1].date
  const span = differenceInCalendarDays(last, first) + 1
  if (span > MAX_SCHEDULE_SPAN_DAYS) return null
  // A plan with no weekend entry at all is a weekday plan, and its
  // Saturdays and Sundays are not missing.
  const weekend = (d: Date): boolean => getDay(d) === 0 || getDay(d) === 6
  const weekdaysOnly = [...seen.values()].every((e) => !weekend(e.date))
  const expected: Date[] = []
  for (let i = 0; i < span; i++) {
    const d = addDays(first, i)
    if (!weekdaysOnly || !weekend(d)) expected.push(d)
  }
  if (seen.size / expected.length < MIN_SCHEDULE_DENSITY) return null
  const missing = expected.map(isoOf).filter((k) => !seen.has(k))
  const doubled = days.filter(([, s]) => s.entries > 1).map(([k]) => k)
  return { first, last, missing, doubled }
}

export interface DateCheckFindings {
  // Weekday-date pairs written, and the wrong ones as written.
  pairs: number
  wrongPairs: WeekdayPair[]
  // ISO days a daily schedule skipped or dated twice.
  missingDays: string[]
  doubledDays: string[]
  // One phrase per distinct finding, in date order, for the appended line.
  items: string[]
}

const NO_FINDINGS: DateCheckFindings = {
  pairs: 0,
  wrongPairs: [],
  missingDays: [],
  doubledDays: [],
  items: [],
}

// Both readings over one reply, with the phrases the appended line would
// name. A reply with no weekday-date pair and no daily schedule yields no
// items; so does a local day that does not parse, since the year a date
// is read in would then be a guess. A wrong pair repeated counts once in
// the items and each time in wrongPairs.
export const dateCheckFindings = (
  text: string,
  localDayIso: string,
): DateCheckFindings => {
  const today = parseISO(localDayIso)
  if (!isValid(today)) return NO_FINDINGS
  const body = text.slice(0, MAX_TEXT_LENGTH)
  const pairs = weekdayPairs(body, today)
  const wrongPairs = pairs.filter((p) => p.wrong)
  const coverage = scheduleCoverage(body, today)
  const missingDays = coverage?.missing ?? []
  const doubledDays = coverage?.doubled ?? []

  const phrases = new Map<string, string>()
  for (const p of wrongPairs) {
    const key = `${isoOf(p.date)} ${p.stated}`
    if (!phrases.has(key)) {
      phrases.set(
        key,
        `${monthDay(p.date)} is a ${weekdayName(p.actual)}, not a ${weekdayName(p.stated)}`,
      )
    }
  }
  for (const k of missingDays) {
    phrases.set(`${k} missing`, `${monthDay(parseISO(k))} has no entry`)
  }
  if (doubledDays.length <= MAX_DOUBLED_AS_FINDING) {
    for (const k of doubledDays) {
      phrases.set(`${k} doubled`, `${monthDay(parseISO(k))} has two entries`)
    }
  }
  const items = [...phrases.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, phrase]) => phrase)
  return { pairs: pairs.length, wrongPairs, missingDays, doubledDays, items }
}

// The line to append, or null when there is nothing to check. Names the
// first findings in date order and counts the rest, so a schedule shifted
// by a whole week reads as four dates and "and 17 more" rather than a wall.
export const dateCheckLine = (findings: DateCheckFindings): string | null => {
  const { items } = findings
  if (items.length === 0) return null
  const named = items.slice(0, MAX_NAMED_FINDINGS)
  const rest = items.length - named.length
  const parts = rest > 0 ? [...named, `and ${rest} more`] : named
  return `${DATE_CHECK_PREFIX}${parts.join('; ')}.`
}
