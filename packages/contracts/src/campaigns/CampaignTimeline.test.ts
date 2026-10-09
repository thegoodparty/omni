import { describe, expect, it } from 'vitest'
import {
  campaignPhaseWindows,
  phaseForDate,
  resolveTrackerTaskDate,
  trackerTimelineStart,
  voterContactSendDate,
} from './CampaignTimeline'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const election = day('2026-11-03')

describe('campaignPhaseWindows', () => {
  it('counts the active campaign and get-out-the-vote back from the election', () => {
    const windows = campaignPhaseWindows(day('2026-01-05'), election)
    expect(windows.active).toEqual(day('2026-08-25'))
    expect(windows.gotv).toEqual(day('2026-10-04'))
  })

  it('compresses Launch for a candidate who joins late', () => {
    const start = day('2026-09-01')
    const windows = campaignPhaseWindows(start, election)
    // Half of the 33 days left before get-out-the-vote, in whole days, so
    // the boundary is a midnight like every task date.
    expect(windows.active).toEqual(day('2026-09-17'))
    expect(windows.gotv).toEqual(day('2026-10-04'))
  })

  it('starts a candidate who joins in the last 30 days in get-out-the-vote', () => {
    const start = day('2026-10-20')
    const windows = campaignPhaseWindows(start, election)
    expect(phaseForDate(windows, start)).toBe('gotv')
  })

  it('keeps a four-week Launch with no election to count back from', () => {
    const windows = campaignPhaseWindows(day('2026-01-05'), null)
    expect(windows.active).toEqual(day('2026-02-02'))
    expect(phaseForDate(windows, day('2027-01-01'))).toBe('active')
  })
})

describe('resolveTrackerTaskDate', () => {
  const windows = campaignPhaseWindows(day('2026-01-05'), election)

  it('dates setup work at the start and going-public work late in Launch', () => {
    expect(
      resolveTrackerTaskDate(
        { timing: { kind: 'asap' }, phase: 'preLaunch' },
        windows,
      ),
    ).toEqual(day('2026-01-05'))
    expect(
      resolveTrackerTaskDate(
        { timing: { kind: 'launch' }, phase: 'launch' },
        windows,
      ),
    ).toEqual(day('2026-08-11'))
  })

  it('still dates election-relative work from the election', () => {
    expect(
      resolveTrackerTaskDate(
        {
          timing: { kind: 'electionRelative', offset: 2, unit: 'weeks' },
          phase: 'gotv',
        },
        windows,
      ),
    ).toEqual(day('2026-10-20'))
  })

  it('parks work with no knowable date at the start of its phase', () => {
    expect(
      resolveTrackerTaskDate(
        { timing: { kind: 'recurring', interval: 'weekly' }, phase: 'active' },
        windows,
      ),
    ).toEqual(day('2026-08-25'))
  })
})

describe('trackerTimelineStart', () => {
  it('reads the start from the do-this-first work', () => {
    expect(
      trackerTimelineStart([
        {
          title: 'Pick your announcement date',
          date: '2026-01-01',
          isDefaultTask: true,
        },
        { title: 'Get your EIN', date: '2026-01-05', isDefaultTask: true },
        { title: 'Canvass', date: '2025-12-01', isDefaultTask: false },
      ]),
    ).toEqual(new Date('2026-01-05'))
  })

  it('has no start without default rows', () => {
    expect(
      trackerTimelineStart([
        { title: 'Canvass', date: '2026-01-01', isDefaultTask: false },
      ]),
    ).toBeNull()
  })
})

describe('voterContactSendDate', () => {
  it('keeps a send on schedule when the plan started before it', () => {
    expect(
      voterContactSendDate('introduction-text', election, day('2026-01-05')),
    ).toEqual(day('2026-09-08'))
  })

  it('compresses a late joiner’s past sends, in order, before the next one', () => {
    const start = day('2026-10-07')
    const date = (id: string) => voterContactSendDate(id, election, start)
    expect(date('introduction-text')).toEqual(day('2026-10-07'))
    expect(date('introduction-robocall')).toEqual(day('2026-10-10'))
    expect(date('persuasion-robocall')).toEqual(day('2026-10-16'))
    expect(date('early-voting-text')).toEqual(day('2026-10-20'))
  })

  it('gives the latest missed sends a day each when days are short', () => {
    // Joined Oct 31 for Nov 3: five sends already past, two days before the
    // Nov 2 reminder. The newest gets its own day; the oldest share the first.
    const start = day('2026-10-31')
    const date = (id: string) => voterContactSendDate(id, election, start)
    expect(date('introduction-text')).toEqual(day('2026-10-31'))
    expect(date('persuasion-robocall')).toEqual(day('2026-10-31'))
    expect(date('early-voting-text')).toEqual(day('2026-11-01'))
    expect(date('election-day-reminder-robocall')).toEqual(day('2026-11-02'))
  })

  it('lands every missed send on the start day when there is no day to spare', () => {
    // Joined the day before the election, the day of the next send.
    const start = day('2026-11-02')
    const date = (id: string) => voterContactSendDate(id, election, start)
    expect(date('introduction-text')).toEqual(start)
    expect(date('early-voting-text')).toEqual(start)
    expect(date('election-day-reminder-text')).toEqual(election)
  })

  it('dates a voter-contact task through the tracker resolver too', () => {
    const windows = campaignPhaseWindows(day('2026-10-07'), election)
    expect(
      resolveTrackerTaskDate(
        {
          id: 'introduction-text',
          timing: { kind: 'electionRelative', offset: 56, unit: 'days' },
          phase: 'launch',
        },
        windows,
      ),
    ).toEqual(day('2026-10-07'))
  })
})
