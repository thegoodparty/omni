import { describe, expect, it } from 'vitest'
import {
  canPutOffTask,
  canSetTaskAsideForGood,
  isTrackerTaskSetAside,
  trackerTaskPutOffDate,
} from './TrackerTaskSkip'

const now = new Date('2026-10-07T15:00:00.000Z')

describe('trackerTaskPutOffDate', () => {
  it('moves a task to three days from today, at UTC midnight', () => {
    expect(trackerTaskPutOffDate(now)).toEqual(
      new Date('2026-10-10T00:00:00.000Z'),
    )
  })
})

describe('canPutOffTask', () => {
  it('never moves a date that is a fact', () => {
    expect(canPutOffTask('Voter Registration Deadline')).toBe(false)
    expect(canPutOffTask('Early Voting Start Date')).toBe(false)
    expect(canPutOffTask('Election Day')).toBe(false)
  })

  it('moves anything planned, including tasks the catalog lacks', () => {
    expect(canPutOffTask('Get your EIN')).toBe(true)
    expect(canPutOffTask('Canvass the east side')).toBe(true)
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
    expect(isTrackerTaskSetAside({ skipReason: 'notForMe' })).toBe(true)
  })

  it('leaves a put-off task in the running, just dated later', () => {
    expect(isTrackerTaskSetAside({ skipReason: 'later' })).toBe(false)
    expect(isTrackerTaskSetAside({ skipReason: null })).toBe(false)
  })
})
