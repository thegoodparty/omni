import { differenceInCalendarDays, format, isValid, parseISO } from 'date-fns'

// The campaign calendar the manager reasons from: every race date and window
// on record or fetched today, each with its status as of the candidate's local
// day, decided here rather than by the model. The dates were already in the
// prompt with weekdays and day counts; the model still wrote "early voting is
// open now" a week before it opened and labeled October 13 a Monday, because
// it derived status and weekday itself. Each entry therefore carries a fixed
// status label, the day count on its own line, one approved sentence that can
// be used as written, and the wrong claim for that status spelled out.

const LONG_DATE = 'EEEE, MMMM d, yyyy'
const MONTH_DAY = 'MMMM d'
const WEEKDAY_MONTH_DAY = 'EEEE, MMMM d'

export type CalendarSource = 'BallotReady' | 'election data' | 'campaign record'

// A window with a start and an end, either of which the source may lack.
export interface CalendarWindow {
  // Upper-case heading, e.g. "EARLY VOTING".
  heading: string
  // The name in a sentence, e.g. "early voting". Lower case; the renderer
  // capitalizes it at the start of the approved description.
  name: string
  // Whether the name takes a plural verb ("mail ballot requests close").
  plural?: boolean
  source: CalendarSource
  start: string | null
  end: string | null
}

// A single day with a value from the campaign record, from today's election
// data, or both. When both are present and differ, the entry is UNKNOWN and
// names the conflict instead of picking a side.
export interface CalendarDate {
  heading: string
  // The name in a sentence, as it reads mid-sentence ("Election Day",
  // "the primary"); the renderer capitalizes it when it starts one.
  name: string
  record: string | null
  live: string | null
}

export interface CalendarInput {
  // The candidate's local day, as a local-midnight Date.
  today: Date
  dates: CalendarDate[]
  windows: CalendarWindow[]
  // The "Do not describe ... as ..." line under each entry. On by default;
  // the chat bench turns it off to measure whether it adds anything.
  cautions?: boolean
}

export const CALENDAR_HEADING = "CALENDAR (as of the candidate's local day)"

export const CALENDAR_RULE =
  'Take dates, weekdays and statuses from this calendar; do not derive ' +
  'them. A weekday you did not read from this prompt or a tool result is ' +
  'not one you can state: write the date without it.'

const parseDay = (iso: string | null | undefined): Date | null => {
  if (!iso) return null
  const parsed = parseISO(iso)
  return isValid(parsed) ? parsed : null
}

// Whether a window gets a calendar entry: at least one side parses as a day.
// The live race block uses the same test to decide which windows it still
// has to call "no window on file", so a malformed feed value never hides a
// window from both.
export const hasCalendarDate = (
  start: string | null | undefined,
  end: string | null | undefined,
): boolean => parseDay(start) !== null || parseDay(end) !== null

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

interface Entry {
  heading: string
  source: CalendarSource | null
  lines: string[]
  description: string
  caution: string | null
}

const renderEntry = (entry: Entry, cautions: boolean): string => {
  const title = entry.source
    ? `${entry.heading} (${entry.source})`
    : entry.heading
  const lines = [
    title,
    ...entry.lines,
    `Approved description: "${entry.description}"`,
  ]
  if (cautions && entry.caution) lines.push(entry.caution)
  return lines.join('\n')
}

// A window's status needs both boundaries to be called open. With one, the
// only safe calls are the ones a single date settles: not yet open before a
// known start, closed after a known end. Anything else is unknown, with the
// missing side named.
const windowEntry = (w: CalendarWindow, today: Date): Entry | null => {
  const start = parseDay(w.start)
  const end = parseDay(w.end)
  if (!start && !end) return null
  const verb = {
    opens: w.plural ? 'open' : 'opens',
    closes: w.plural ? 'close' : 'closes',
    is: w.plural ? 'are' : 'is',
    its: w.plural ? 'their' : 'its',
  }
  const startWords = start ? format(start, LONG_DATE) : 'not on file'
  const endWords = end ? format(end, LONG_DATE) : 'not on file'
  const lines = [`Opens: ${startWords}`, `Closes: ${endWords}`]
  const Name = capitalize(w.name)
  const toStart = start ? differenceInCalendarDays(start, today) : null
  const toEnd = end ? differenceInCalendarDays(end, today) : null

  // A feed value with the end before the start settles nothing.
  if (start && end && differenceInCalendarDays(end, start) < 0) {
    return {
      heading: w.heading,
      source: w.source,
      lines: [...lines, 'Status: UNKNOWN', 'Reason: boundaries_out_of_order'],
      description: `Confirm the ${w.name} dates before planning around them.`,
      caution: `Do not state whether ${w.name} ${verb.is} open.`,
    }
  }
  if (toStart !== null && toStart > 0) {
    return {
      heading: w.heading,
      source: w.source,
      lines: [
        ...lines,
        'Status: NOT YET OPEN',
        `Days until it opens: ${toStart}`,
      ],
      description: `${Name} ${verb.opens} ${format(start!, MONTH_DAY)}.`,
      caution: `Do not describe ${w.name} as currently open.`,
    }
  }
  if (toEnd !== null && toEnd < 0) {
    return {
      heading: w.heading,
      source: w.source,
      lines: [...lines, 'Status: CLOSED', `Days since it closed: ${-toEnd}`],
      description: `${Name} closed ${format(end!, MONTH_DAY)}.`,
      caution: `Do not describe ${w.name} as open.`,
    }
  }
  if (start && end) {
    return {
      heading: w.heading,
      source: w.source,
      lines: [...lines, 'Status: OPEN', `Days until it closes: ${toEnd}`],
      description: `${Name} ${verb.is} open through ${format(end, MONTH_DAY)}.`,
      caution: `Do not describe ${w.name} as not yet open or as over.`,
    }
  }
  // One side only, and that side settles nothing on its own: a start that is
  // behind may or may not have been followed by a close; an end that is ahead
  // says nothing about whether the window has opened. The sentence states
  // the date on file; the caution forbids the inference, not the date.
  if (start) {
    return {
      heading: w.heading,
      source: w.source,
      lines: [
        ...lines,
        'Status: UNKNOWN',
        'Reason: closing_date_unknown',
        `Days since it opened: ${-toStart!}`,
      ],
      description: `${Name} opened ${format(start, MONTH_DAY)}.`,
      caution: `Do not describe ${w.name} as open; only ${verb.its} opening date is on file.`,
    }
  }
  return {
    heading: w.heading,
    source: w.source,
    lines: [
      ...lines,
      'Status: UNKNOWN',
      'Reason: opening_date_unknown',
      `Days until it closes: ${toEnd}`,
    ],
    description: `${Name} ${verb.closes} ${format(end!, MONTH_DAY)}.`,
    caution: `Do not describe ${w.name} as open; only ${verb.its} closing date is on file.`,
  }
}

const dateEntry = (d: CalendarDate, today: Date): Entry | null => {
  const record = parseDay(d.record)
  const live = parseDay(d.live)
  if (!record && !live) return null
  if (record && live && differenceInCalendarDays(record, live) !== 0) {
    return {
      heading: d.heading,
      source: null,
      lines: [
        'Status: UNKNOWN',
        'Reason: conflicting_sources',
        `Campaign record: ${format(record, LONG_DATE)}`,
        `Election data: ${format(live, LONG_DATE)}`,
      ],
      description: `Confirm the date of ${d.name} before planning around it.`,
      caution: `Do not state the date of ${d.name} as settled.`,
    }
  }
  const day = (live ?? record)!
  const source: CalendarSource = live ? 'election data' : 'campaign record'
  const days = differenceInCalendarDays(day, today)
  const when = format(day, WEEKDAY_MONTH_DAY)
  if (days === 0) {
    return {
      heading: d.heading,
      source,
      lines: [format(day, LONG_DATE), 'Status: TODAY'],
      description: `${capitalize(d.name)} is today, ${when}.`,
      caution: null,
    }
  }
  if (days > 0) {
    return {
      heading: d.heading,
      source,
      lines: [
        format(day, LONG_DATE),
        'Status: UPCOMING',
        `Days remaining: ${days}`,
      ],
      description: `${capitalize(d.name)} is ${when}.`,
      caution: `Do not describe ${d.name} as past.`,
    }
  }
  return {
    heading: d.heading,
    source,
    lines: [format(day, LONG_DATE), 'Status: PASSED', `Days since: ${-days}`],
    description: `${capitalize(d.name)} was ${when}.`,
    caution: `Do not describe ${d.name} as upcoming.`,
  }
}

// The whole block, or null when nothing on record or fetched today gives it
// an entry, so a campaign with no dates gets no calendar rather than an empty
// heading.
export const buildCalendarBlock = (input: CalendarInput): string | null => {
  const cautions = input.cautions ?? true
  const entries: Entry[] = []
  for (const d of input.dates) {
    const entry = dateEntry(d, input.today)
    if (entry) entries.push(entry)
  }
  for (const w of input.windows) {
    const entry = windowEntry(w, input.today)
    if (entry) entries.push(entry)
  }
  if (entries.length === 0) return null
  return [
    `${CALENDAR_HEADING}\n${CALENDAR_RULE}`,
    ...entries.map((e) => renderEntry(e, cautions)),
  ].join('\n\n')
}
