import { addDays, format, isBefore } from 'date-fns'
import type { MeetingsListItemDto } from 'gpApi/api-endpoints'

const DEFAULT_MEETING_MINUTES = 120

// The official's first meeting as the flow knows it: what the office's
// meeting schedule says, or the day and time they gave when that was wrong.
export interface FirstMeeting {
  // Midnight, local to this browser, of the meeting's calendar day. Only its
  // year, month and day are read.
  day: Date
  // Minutes past midnight on the meeting's own clock.
  startMinutes: number
  durationMinutes: number
  // The body that meets ("City Council"), or '' when the schedule has none.
  name: string
  location: string
  // IANA zone of the meeting's clock, when the schedule gave one.
  timeZone: string | null
  // From the office's meeting schedule, or stated by the official.
  source: 'found' | 'picked'
}

// Where the meeting is, as the card shows it: the place in bold and the
// street and city under it. The schedule holds one line for both.
export interface MeetingPlace {
  place: string
  address: string
}

const STATE_AND_ZIP = /,\s*[A-Z]{2}(\s+\d{5}(-\d{4})?)?\s*$/

export const meetingPlace = (location: string): MeetingPlace | null => {
  const text = location.trim()
  if (!text) return null
  const comma = text.indexOf(',')
  return {
    place: comma > 0 ? text.slice(0, comma).trim() : text,
    address:
      comma > 0
        ? text
            .slice(comma + 1)
            .trim()
            .replace(STATE_AND_ZIP, '')
        : '',
  }
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export const parseDay = (value: string | null | undefined): Date | null => {
  const match = value ? DAY_RE.exec(value.slice(0, 10)) : null
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

const parseMinutes = (value: string): number | null => {
  const match = TIME_RE.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

// The first meeting still ahead that falls in the official's term. A meeting
// before they take office is the outgoing body's, not theirs.
export const firstMeetingFrom = (
  meetings: MeetingsListItemDto[],
  termStart: Date | null,
  today: Date,
): FirstMeeting | null => {
  const earliest = termStart && isBefore(today, termStart) ? termStart : today
  const dated = meetings
    .flatMap((meeting) => {
      const day = parseDay(meeting.meetingDate)
      const startMinutes = parseMinutes(meeting.meetingTime)
      return day && startMinutes !== null
        ? [{ meeting, day, startMinutes }]
        : []
    })
    .sort((a, b) => a.day.getTime() - b.day.getTime())
  const first = dated.find(({ day }) => !isBefore(day, earliest))
  if (!first) return null
  return {
    day: first.day,
    startMinutes: first.startMinutes,
    durationMinutes:
      first.meeting.durationMinutes > 0
        ? first.meeting.durationMinutes
        : DEFAULT_MEETING_MINUTES,
    name: first.meeting.meetingName.trim(),
    location: first.meeting.location.trim(),
    timeZone: first.meeting.meetingTimezone || null,
    source: first.meeting.source === 'official' ? 'picked' : 'found',
  }
}

// The day and time the official gave, keeping what the schedule said about
// everything else.
export const pickedMeeting = (
  found: FirstMeeting,
  day: Date,
  startMinutes: number,
): FirstMeeting => ({ ...found, day, startMinutes, source: 'picked' })

// "Thursday, January 7"
export const longDay = (day: Date): string => format(day, 'EEEE, MMMM d')

// "January 7"
export const monthDay = (day: Date): string => format(day, 'MMMM d')

// "Jan 7"
export const shortMonthDay = (day: Date): string => format(day, 'MMM d')

const hour12 = (minutes: number): string => {
  const hours = Math.floor(minutes / 60) % 24
  const mins = minutes % 60
  return `${((hours + 11) % 12) + 1}:${String(mins).padStart(2, '0')}`
}

const meridiem = (minutes: number): 'am' | 'pm' =>
  Math.floor(minutes / 60) % 24 < 12 ? 'am' : 'pm'

// "7:00 pm"
export const clockTime = (minutes: number): string =>
  `${hour12(minutes)} ${meridiem(minutes)}`

// "7:00 to 9:00 pm", or "11:30 am to 1:30 pm" across noon
export const clockRange = (meeting: FirstMeeting): string => {
  const end = meeting.startMinutes + meeting.durationMinutes
  const startHalf = meridiem(meeting.startMinutes)
  const endHalf = meridiem(end)
  const start =
    startHalf === endHalf
      ? hour12(meeting.startMinutes)
      : clockTime(meeting.startMinutes)
  return `${start} to ${hour12(end)} ${endHalf}`
}

// "City Council meeting", without doubling a name that already ends in it.
export const meetingTitle = (meeting: FirstMeeting): string => {
  if (!meeting.name) return 'First meeting'
  return /meeting$/i.test(meeting.name)
    ? meeting.name
    : `${meeting.name} meeting`
}

export type CalendarId =
  | 'google'
  | 'apple'
  | 'outlook'
  | 'microsoft365'
  | 'yahoo'
  | 'ics'

export interface CalendarLink {
  id: CalendarId
  // On the button.
  label: string
  // In "Opened in ..." or "Saved for ...".
  calendarName: string
  href: string
  // A file to save, not a page to open.
  download: boolean
}

const pad = (value: number): string => String(value).padStart(2, '0')

const stamp = (day: Date, minutes: number): string => {
  // A meeting that runs past midnight ends on the next day.
  const on = addDays(day, Math.floor(minutes / (24 * 60)))
  const clock = minutes % (24 * 60)
  return `${format(on, 'yyyyMMdd')}T${pad(Math.floor(clock / 60))}${pad(clock % 60)}00`
}

const dashedStamp = (day: Date, minutes: number): string => {
  const on = addDays(day, Math.floor(minutes / (24 * 60)))
  const clock = minutes % (24 * 60)
  return `${format(on, 'yyyy-MM-dd')}T${pad(Math.floor(clock / 60))}:${pad(clock % 60)}:00`
}

const icsText = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')

export const meetingIcs = (
  meeting: FirstMeeting,
  now: Date,
  details = '',
): string => {
  const start = meeting.startMinutes
  const end = start + meeting.durationMinutes
  const zone = meeting.timeZone ? `;TZID=${meeting.timeZone}` : ''
  const utcStamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GoodParty.org//Serve//EN',
    'BEGIN:VEVENT',
    `UID:serve-first-meeting-${format(meeting.day, 'yyyyMMdd')}@goodparty.org`,
    `DTSTAMP:${utcStamp}`,
    `DTSTART${zone}:${stamp(meeting.day, start)}`,
    `DTEND${zone}:${stamp(meeting.day, end)}`,
    `SUMMARY:${icsText(meetingTitle(meeting))}`,
    ...(meeting.location ? [`LOCATION:${icsText(meeting.location)}`] : []),
    ...(details ? [`DESCRIPTION:${icsText(details)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

// Google, Outlook.com, Microsoft 365 and Yahoo take a link. Apple Calendar
// and every desktop app take the .ics file, since Apple has no web link.
export const calendarLinks = (
  meeting: FirstMeeting,
  details = '',
  now: Date = new Date(),
): CalendarLink[] => {
  const title = meetingTitle(meeting)
  const start = meeting.startMinutes
  const end = start + meeting.durationMinutes
  const text = encodeURIComponent(title)
  const location = encodeURIComponent(meeting.location)
  const body = encodeURIComponent(details)
  const zone = meeting.timeZone
    ? `&ctz=${encodeURIComponent(meeting.timeZone)}`
    : ''
  const outlook = (host: string): string =>
    `https://${host}/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${text}&startdt=${dashedStamp(meeting.day, start)}&enddt=${dashedStamp(meeting.day, end)}&body=${body}&location=${location}`
  const file = `data:text/calendar;charset=utf-8,${encodeURIComponent(meetingIcs(meeting, now, details))}`
  return [
    {
      id: 'google',
      label: 'Google',
      calendarName: 'Google Calendar',
      href: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${stamp(meeting.day, start)}/${stamp(meeting.day, end)}${zone}&details=${body}&location=${location}`,
      download: false,
    },
    {
      id: 'apple',
      label: 'Apple',
      calendarName: 'Apple Calendar',
      href: file,
      download: true,
    },
    {
      id: 'outlook',
      label: 'Outlook',
      calendarName: 'Outlook',
      href: outlook('outlook.live.com'),
      download: false,
    },
    {
      id: 'microsoft365',
      label: 'Microsoft 365',
      calendarName: 'Microsoft 365',
      href: outlook('outlook.office.com'),
      download: false,
    },
    {
      id: 'yahoo',
      label: 'Yahoo',
      calendarName: 'Yahoo Calendar',
      href: `https://calendar.yahoo.com/?v=60&title=${text}&st=${stamp(meeting.day, start)}&et=${stamp(meeting.day, end)}&desc=${body}&in_loc=${location}`,
      download: false,
    },
    {
      id: 'ics',
      label: '.ics file',
      calendarName: 'your calendar',
      href: file,
      download: true,
    },
  ]
}

// "th" for 7, "st" for 21
export const ordinal = (day: number): string => {
  const rest = day % 100
  if (rest >= 11 && rest <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][Math.min(day % 10, 4)] ?? 'th'
}

// "7:00" and "pm", for the date sentence's time word.
export const clockParts = (minutes: number): [string, 'am' | 'pm'] => [
  hour12(minutes),
  meridiem(minutes),
]

// Every half hour from 8:00 am to 9:30 pm, as minutes past midnight.
export const MEETING_TIMES = Array.from(
  { length: (21 * 60 + 30 - 8 * 60) / 30 + 1 },
  (_, index) => 8 * 60 + index * 30,
)

// The twelve months a first meeting can fall in, starting with this one.
export const upcomingMonths = (today: Date): Date[] =>
  Array.from(
    { length: 12 },
    (_, index) => new Date(today.getFullYear(), today.getMonth() + index, 1),
  )

export const daysInMonth = (month: Date): number =>
  new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()

export const toDayString = (day: Date): string => format(day, 'yyyy-MM-dd')

export const toTimeString = (minutes: number): string =>
  `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`
