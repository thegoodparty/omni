import { describe, expect, it } from 'vitest'
import {
  canSetTaskAsideForGood,
  isTrackerTaskSetAside,
  trackerTaskSnoozeUntil,
} from './TrackerTaskSkip'

const now = new Date('2026-10-07T15:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

describe('trackerTaskSnoozeUntil', () => {
  it('puts a task off three days when it is not due before then', () => {
    expect(trackerTaskSnoozeUntil(now, '2026-10-20T00:00:00.000Z')).toEqual(
      new Date(now.getTime() + 3 * DAY),
    )
  })

  it('brings it back on its due date when that comes first', () => {
    expect(trackerTaskSnoozeUntil(now, '2026-10-09T00:00:00.000Z')).toEqual(
      new Date('2026-10-09T00:00:00.000Z'),
    )
  })

  it('uses the three days for a task already past due', () => {
    expect(trackerTaskSnoozeUntil(now, '2026-10-04T00:00:00.000Z')).toEqual(
      new Date(now.getTime() + 3 * DAY),
    )
  })
})

describe('canSetTaskAsideForGood', () => {
  it('keeps ballot access from being dropped', () => {
    expect(canSetTaskAsideForGood('Submit your Ballot Access Signatures')).toBe(
      false,
    )
    expect(canSetTaskAsideForGood('Begin Ballot Access Period')).toBe(false)
  })

  it('lets finance reporting be dropped, since not every candidate must file', () => {
    expect(
      canSetTaskAsideForGood(
        'Add your campaign finance deadlines to your calendar',
      ),
    ).toBe(true)
    expect(canSetTaskAsideForGood('File your final report')).toBe(true)
  })

  it('lets anything else be set aside, including tasks the catalog lacks', () => {
    expect(canSetTaskAsideForGood('Knock on Doors')).toBe(true)
    expect(canSetTaskAsideForGood('Host a meet and greet')).toBe(true)
  })
})

describe('isTrackerTaskSetAside', () => {
  it('holds a not-for-me task aside until it is brought back', () => {
    expect(
      isTrackerTaskSetAside(
        { skipReason: 'notForMe', snoozedUntil: null },
        now,
      ),
    ).toBe(true)
  })

  it('holds a put-off task aside only until its snooze runs out', () => {
    const later = (until: Date) => ({
      skipReason: 'later' as const,
      snoozedUntil: until,
    })
    expect(
      isTrackerTaskSetAside(later(new Date(now.getTime() + DAY)), now),
    ).toBe(true)
    expect(
      isTrackerTaskSetAside(later(new Date(now.getTime() - DAY)), now),
    ).toBe(false)
  })

  it('is not set aside without a reason', () => {
    expect(
      isTrackerTaskSetAside({ skipReason: null, snoozedUntil: null }, now),
    ).toBe(false)
  })
})
