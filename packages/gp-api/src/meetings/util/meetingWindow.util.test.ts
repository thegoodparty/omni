import { describe, expect, it } from 'vitest'
import {
  dayInZone,
  meetingStart,
  meetingsInWindow,
  recurrenceDays,
  shiftDay,
  stateTimezone,
} from './meetingWindow.util'

const EASTERN = 'America/New_York'
const PACIFIC = 'America/Los_Angeles'

// The daily job's hour: 07:00 UTC is 2 am Eastern in winter.
const run = (day: string) => new Date(`${day}T07:00:00Z`)

const thursdayAt7pm = { meetingDate: '2027-01-07', meetingTime: '19:00' }

const inWindow = (
  now: Date,
  overrides: Partial<Parameters<typeof meetingsInWindow>[0]> = {},
) =>
  meetingsInWindow({
    scheduled: [thursdayAt7pm],
    stated: null,
    timezone: EASTERN,
    now,
    windowDays: 3,
    ...overrides,
  })

describe('dayInZone', () => {
  it('reads the day on the zone’s own clock, not UTC’s', () => {
    const lateEvening = new Date('2027-01-08T01:30:00Z')

    expect(dayInZone(lateEvening, EASTERN)).toBe('2027-01-07')
    expect(dayInZone(lateEvening, 'UTC')).toBe('2027-01-08')
  })
})

describe('shiftDay', () => {
  it('moves by calendar days across a month and a clock change', () => {
    expect(shiftDay('2027-01-30', 3)).toBe('2027-02-02')
    expect(shiftDay('2027-03-13', 3)).toBe('2027-03-16')
    expect(shiftDay('2027-01-07', -3)).toBe('2027-01-04')
  })
})

describe('meetingStart', () => {
  it('is the instant of the meeting’s wall clock in its zone', () => {
    expect(meetingStart(thursdayAt7pm, EASTERN).toISOString()).toBe(
      '2027-01-08T00:00:00.000Z',
    )
    expect(meetingStart(thursdayAt7pm, PACIFIC).toISOString()).toBe(
      '2027-01-08T03:00:00.000Z',
    )
  })
})

describe('recurrenceDays', () => {
  it('lists the days a weekly rule lands on between two days', () => {
    expect(
      recurrenceDays(
        { rrule: 'FREQ=WEEKLY;BYDAY=TH', time: '19:00' },
        '2027-01-04',
        '2027-01-21',
      ),
    ).toEqual(['2027-01-07', '2027-01-14', '2027-01-21'])
  })

  it('keeps an evening meeting on its own day', () => {
    // 11:30 pm Eastern is already the next day in UTC.
    expect(
      recurrenceDays(
        { rrule: 'FREQ=WEEKLY;BYDAY=TH', time: '23:30' },
        '2027-01-07',
        '2027-01-07',
      ),
    ).toEqual(['2027-01-07'])
  })

  it('throws on a rule it cannot read', () => {
    expect(() =>
      recurrenceDays(
        { rrule: 'not a rule', time: '19:00' },
        '2027-01-04',
        '2027-01-07',
      ),
    ).toThrow()
  })
})

describe('meetingsInWindow', () => {
  it('takes a 7 pm meeting three calendar days ahead, not two', () => {
    // Monday's run. Read as UTC, the meeting's 7 pm falls outside the 72
    // hours after 07:00 and was only caught on Tuesday.
    expect(inWindow(run('2027-01-03'))).toEqual([])
    expect(inWindow(run('2027-01-04'))).toEqual([thursdayAt7pm])
  })

  it('counts the days on the meeting’s clock when the run is the evening before there', () => {
    // 07:00 UTC is 11 pm the previous day in Pacific winter time, so the run
    // dated Monday in UTC is still Sunday for the meeting.
    expect(inWindow(run('2027-01-04'), { timezone: PACIFIC })).toEqual([])
    expect(inWindow(run('2027-01-05'), { timezone: PACIFIC })).toEqual([
      thursdayAt7pm,
    ])
  })

  it('takes a meeting later today and drops one that has started', () => {
    expect(inWindow(new Date('2027-01-07T23:59:00Z'))).toEqual([thursdayAt7pm])
    expect(inWindow(new Date('2027-01-08T00:01:00Z'))).toEqual([])
  })

  it('returns the meetings earliest first', () => {
    const tuesday = { meetingDate: '2027-01-05', meetingTime: '19:00' }

    expect(
      inWindow(run('2027-01-04'), { scheduled: [thursdayAt7pm, tuesday] }),
    ).toEqual([tuesday, thursdayAt7pm])
  })

  describe('with a first meeting the official stated', () => {
    const stated = { meetingDate: '2027-01-06', meetingTime: '18:30' }
    const tuesday = { meetingDate: '2027-01-05', meetingTime: '19:00' }

    it('leaves out the scheduled meetings before it and adds it', () => {
      expect(
        inWindow(run('2027-01-04'), {
          scheduled: [tuesday, thursdayAt7pm],
          stated,
        }),
      ).toEqual([stated, thursdayAt7pm])
    })

    it('replaces the scheduled meeting on its own day', () => {
      const sameDay = { meetingDate: '2027-01-07', meetingTime: '17:00' }

      expect(inWindow(run('2027-01-04'), { stated: sameDay })).toEqual([
        sameDay,
      ])
    })

    it('waits for the window like any other meeting', () => {
      const later = { meetingDate: '2027-01-21', meetingTime: '19:00' }

      expect(
        inWindow(run('2027-01-04'), {
          scheduled: [thursdayAt7pm],
          stated: later,
        }),
      ).toEqual([])
      expect(
        inWindow(run('2027-01-18'), { scheduled: [], stated: later }),
      ).toEqual([later])
    })

    it('stops shaping the schedule once its day has passed', () => {
      const lastWeek = { meetingDate: '2026-12-30', meetingTime: '19:00' }

      expect(inWindow(run('2027-01-04'), { stated: lastWeek })).toEqual([
        thursdayAt7pm,
      ])
    })
  })
})

describe('stateTimezone', () => {
  it('names the state’s main zone the tz-database way', () => {
    expect(stateTimezone('MA')).toBe('America/New_York')
    expect(stateTimezone('tx')).toBe('America/Chicago')
    expect(stateTimezone('AZ')).toBe('America/Phoenix')
    expect(stateTimezone('HI')).toBe('Pacific/Honolulu')
  })

  it('falls back to Eastern when the state is unknown', () => {
    expect(stateTimezone(null)).toBe('America/New_York')
    expect(stateTimezone('ZZ')).toBe('America/New_York')
  })
})
