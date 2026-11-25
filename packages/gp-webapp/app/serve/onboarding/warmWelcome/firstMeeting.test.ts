import { describe, expect, it } from 'vitest'
import type { MeetingsListItemDto } from 'gpApi/api-endpoints'
import {
  calendarLinks,
  clockParts,
  clockRange,
  clockTime,
  daysInMonth,
  firstMeetingFrom,
  MEETING_TIMES,
  meetingIcs,
  meetingPlace,
  meetingTitle,
  ordinal,
  parseDay,
  pickedMeeting,
  toDayString,
  toTimeString,
  upcomingMonths,
  type FirstMeeting,
} from './firstMeeting'

const row = (
  overrides: Partial<MeetingsListItemDto> = {},
): MeetingsListItemDto => ({
  meetingDate: '2027-01-07',
  meetingTime: '19:00',
  meetingTimezone: 'America/New_York',
  durationMinutes: 120,
  meetingName: 'City Council',
  location: 'City Hall, 210 Main Street',
  hasBriefing: false,
  ...overrides,
})

const TODAY = new Date(2026, 10, 24)

const meeting = (overrides: Partial<FirstMeeting> = {}): FirstMeeting => ({
  day: new Date(2027, 0, 7),
  startMinutes: 19 * 60,
  durationMinutes: 120,
  name: 'City Council',
  location: 'City Hall, 210 Main Street',
  timeZone: 'America/New_York',
  source: 'found',
  point: null,
  ...overrides,
})

describe('firstMeetingFrom', () => {
  it('takes the first meeting on or after the day the term starts', () => {
    const found = firstMeetingFrom(
      [
        row({ meetingDate: '2027-01-21' }),
        row({ meetingDate: '2026-12-03' }),
        row({ meetingDate: '2027-01-07' }),
      ],
      new Date(2027, 0, 4),
      TODAY,
    )
    expect(found).toEqual(meeting())
  })

  it('takes the next meeting ahead when the term has already started', () => {
    const found = firstMeetingFrom(
      [row({ meetingDate: '2026-11-19' }), row({ meetingDate: '2026-12-03' })],
      new Date(2026, 0, 4),
      TODAY,
    )
    expect(found?.day).toEqual(new Date(2026, 11, 3))
  })

  it('never offers a meeting that has passed, with or without a term', () => {
    expect(
      firstMeetingFrom([row({ meetingDate: '2026-11-19' })], null, TODAY),
    ).toBeNull()
  })

  it('has no first meeting when the schedule ends before the term starts', () => {
    expect(
      firstMeetingFrom(
        [row({ meetingDate: '2026-12-03' })],
        new Date(2027, 0, 4),
        TODAY,
      ),
    ).toBeNull()
  })

  it('skips a row with no usable date or time', () => {
    const found = firstMeetingFrom(
      [
        row({ meetingDate: '2026-12-03', meetingTime: '' }),
        row({ meetingDate: 'soon' }),
        row({ meetingDate: '2026-12-17' }),
      ],
      null,
      TODAY,
    )
    expect(found?.day).toEqual(new Date(2026, 11, 17))
  })

  it('assumes two hours when the schedule gives no length', () => {
    const found = firstMeetingFrom([row({ durationMinutes: 0 })], null, TODAY)
    expect(found?.durationMinutes).toBe(120)
  })

  it('has none for an empty schedule', () => {
    expect(firstMeetingFrom([], null, TODAY)).toBeNull()
  })
})

describe('meeting dates and times', () => {
  it('reads a date-only string as that calendar day', () => {
    expect(parseDay('2027-01-04')).toEqual(new Date(2027, 0, 4))
    expect(parseDay('2027-01-04T00:00:00.000Z')).toEqual(new Date(2027, 0, 4))
    expect(parseDay(null)).toBeNull()
    expect(parseDay('January')).toBeNull()
  })

  it('writes times the way the copy does', () => {
    expect(clockTime(19 * 60)).toBe('7:00 pm')
    expect(clockTime(11 * 60)).toBe('11:00 am')
    expect(clockTime(0)).toBe('12:00 am')
    expect(clockTime(12 * 60 + 30)).toBe('12:30 pm')
  })

  it('names the half of the day once when a meeting stays in it', () => {
    expect(clockRange(meeting())).toBe('7:00 to 9:00 pm')
    expect(clockRange(meeting({ startMinutes: 11 * 60 + 30 }))).toBe(
      '11:30 am to 1:30 pm',
    )
  })

  it('keeps everything but the day and time when the official corrects it', () => {
    const corrected = pickedMeeting(meeting(), new Date(2027, 0, 12), 18 * 60)
    expect(corrected).toEqual(
      meeting({
        day: new Date(2027, 0, 12),
        startMinutes: 18 * 60,
        source: 'picked',
      }),
    )
  })
})

// gp-api's daily job runs at 07:00 UTC and picks up a meeting that starts
// within three days, reading the meeting's own clock as UTC.
describe('meetingTitle', () => {
  it('names the body that meets', () => {
    expect(meetingTitle(meeting())).toBe('City Council meeting')
  })

  it('does not double a name that already ends in meeting', () => {
    expect(meetingTitle(meeting({ name: 'Board of Education Meeting' }))).toBe(
      'Board of Education Meeting',
    )
  })

  it('has a plain title when the schedule names no body', () => {
    expect(meetingTitle(meeting({ name: '' }))).toBe('First meeting')
  })
})

const DETAILS = 'Your first City Council meeting. Added from Serve.'

describe('calendarLinks', () => {
  const NOW = new Date('2026-11-24T15:00:00.000Z')
  const links = calendarLinks(meeting(), DETAILS, NOW)
  const byId = Object.fromEntries(links.map((link) => [link.id, link]))

  it('offers the six ways to add it, in the order the card shows them', () => {
    expect(links.map((link) => link.label)).toEqual([
      'Google',
      'Apple',
      'Outlook',
      'Microsoft 365',
      'Yahoo',
      '.ics file',
    ])
  })

  it('builds a Google link in the meeting’s own time zone', () => {
    const url = new URL(byId.google!.href)
    expect(url.origin + url.pathname).toBe(
      'https://calendar.google.com/calendar/render',
    )
    expect(url.searchParams.get('text')).toBe('City Council meeting')
    expect(url.searchParams.get('dates')).toBe(
      '20270107T190000/20270107T210000',
    )
    expect(url.searchParams.get('ctz')).toBe('America/New_York')
    expect(url.searchParams.get('location')).toBe('City Hall, 210 Main Street')
  })

  it('builds the two Outlook links on their own hosts', () => {
    const live = new URL(byId.outlook!.href)
    const office = new URL(byId.microsoft365!.href)
    expect(live.host).toBe('outlook.live.com')
    expect(office.host).toBe('outlook.office.com')
    expect(live.searchParams.get('startdt')).toBe('2027-01-07T19:00:00')
    expect(live.searchParams.get('enddt')).toBe('2027-01-07T21:00:00')
    expect(office.searchParams.get('subject')).toBe('City Council meeting')
  })

  it('builds a Yahoo link', () => {
    const url = new URL(byId.yahoo!.href)
    expect(url.searchParams.get('st')).toBe('20270107T190000')
    expect(url.searchParams.get('et')).toBe('20270107T210000')
    expect(url.searchParams.get('title')).toBe('City Council meeting')
  })

  it('says where the entry came from, in every link and in the file', () => {
    expect(new URL(byId.google!.href).searchParams.get('details')).toBe(DETAILS)
    expect(new URL(byId.outlook!.href).searchParams.get('body')).toBe(DETAILS)
    expect(new URL(byId.yahoo!.href).searchParams.get('desc')).toBe(DETAILS)
    expect(meetingIcs(meeting(), NOW, DETAILS)).toContain(
      'DESCRIPTION:Your first City Council meeting. Added from Serve.',
    )
  })

  it('gives Apple Calendar and every other app the same file to save', () => {
    expect(byId.apple!.download).toBe(true)
    expect(byId.ics!.download).toBe(true)
    expect(byId.google!.download).toBe(false)
    expect(byId.apple!.href).toBe(byId.ics!.href)
    expect(
      decodeURIComponent(
        byId.ics!.href.replace('data:text/calendar;charset=utf-8,', ''),
      ),
    ).toBe(meetingIcs(meeting(), NOW, DETAILS))
  })
})

describe('meetingIcs', () => {
  const NOW = new Date('2026-11-24T15:04:05.000Z')

  it('writes the event on the meeting’s clock', () => {
    expect(meetingIcs(meeting(), NOW).split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//GoodParty.org//Serve//EN',
      'BEGIN:VEVENT',
      'UID:serve-first-meeting-20270107@goodparty.org',
      'DTSTAMP:20261124T150405Z',
      'DTSTART;TZID=America/New_York:20270107T190000',
      'DTEND;TZID=America/New_York:20270107T210000',
      'SUMMARY:City Council meeting',
      'LOCATION:City Hall\\, 210 Main Street',
      'END:VEVENT',
      'END:VCALENDAR',
    ])
  })

  it('ends on the next day when a meeting runs past midnight', () => {
    const ics = meetingIcs(
      meeting({ startMinutes: 23 * 60, durationMinutes: 120 }),
      NOW,
    )
    expect(ics).toContain('DTSTART;TZID=America/New_York:20270107T230000')
    expect(ics).toContain('DTEND;TZID=America/New_York:20270108T010000')
  })

  it('leaves the zone and the place out when the schedule has neither', () => {
    const ics = meetingIcs(meeting({ timeZone: null, location: '' }), NOW)
    expect(ics).toContain('DTSTART:20270107T190000')
    expect(ics).not.toContain('LOCATION')
  })
})

describe('meetingPlace', () => {
  it('splits one line into the place and the street and city', () => {
    expect(
      meetingPlace('City Hall, 210 Main Street, Northampton, MA 01060'),
    ).toEqual({
      place: 'City Hall',
      address: '210 Main Street, Northampton',
      room: '',
    })
  })

  it('uses the parts the schedule holds, room included', () => {
    expect(
      meetingPlace('City Hall', {
        name: 'City Hall',
        address: '210 Main Street, Northampton, MA',
        room: 'Council chambers, second floor',
      }),
    ).toEqual({
      place: 'City Hall',
      address: '210 Main Street, Northampton',
      room: 'Council chambers, second floor',
    })
  })

  it('is just the place when that is all there is', () => {
    expect(meetingPlace('Town Hall')).toEqual({
      place: 'Town Hall',
      address: '',
      room: '',
    })
  })

  it('has nothing to show for an empty location', () => {
    expect(meetingPlace('  ')).toBeNull()
  })
})

describe('the date sentence', () => {
  it('ends each day the way it is said', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
      'st',
      'nd',
      'rd',
      'th',
      'th',
      'th',
      'th',
      'st',
      'nd',
      'rd',
      'st',
    ])
  })

  it('splits a time into its clock and its half of the day', () => {
    expect(clockParts(19 * 60)).toEqual(['7:00', 'pm'])
    expect(clockParts(8 * 60 + 30)).toEqual(['8:30', 'am'])
  })

  it('offers every half hour from 8:00 am to 9:30 pm', () => {
    expect(MEETING_TIMES[0]).toBe(8 * 60)
    expect(MEETING_TIMES.at(-1)).toBe(21 * 60 + 30)
    expect(MEETING_TIMES).toHaveLength(28)
  })

  it('offers the twelve months starting with this one', () => {
    const months = upcomingMonths(TODAY)
    expect(months).toHaveLength(12)
    expect(months[0]).toEqual(new Date(2026, 10, 1))
    expect(months[11]).toEqual(new Date(2027, 9, 1))
  })

  it('knows how long each month is', () => {
    expect(daysInMonth(new Date(2027, 1, 1))).toBe(28)
    expect(daysInMonth(new Date(2028, 1, 1))).toBe(29)
  })

  it('writes the day and time the way gp-api takes them', () => {
    expect(toDayString(new Date(2027, 0, 7))).toBe('2027-01-07')
    expect(toTimeString(19 * 60)).toBe('19:00')
    expect(toTimeString(8 * 60 + 30)).toBe('08:30')
  })
})
