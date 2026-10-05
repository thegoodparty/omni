import { describe, expect, it } from 'vitest'
import { formatScheduledSend } from './scheduledSendLabel.util'

describe('formatScheduledSend', () => {
  // Kassandra Shamsrouf (Victorville CA), 2026-10-05: a Tuesday 6 PM Pacific
  // robocall is 01:00 UTC Wednesday, and the notice read "Wed Oct 07".
  it('names the candidate-local day of an evening send, not the UTC day', () => {
    expect(
      formatScheduledSend({
        date: new Date('2026-10-07T01:00:00Z'),
        scheduledLocalDate: '2026-10-06',
        scheduledLocalTime: null,
        timeZone: 'US/Pacific',
      }),
    ).toBe('Tue, Oct 6, 2026 at 6:00 PM PDT')
  })

  it('renders the stored wall clock in the campaign zone when a time is stored', () => {
    expect(
      formatScheduledSend({
        date: new Date('2026-10-06T02:00:00Z'),
        scheduledLocalDate: '2026-10-05',
        scheduledLocalTime: '19:00',
        timeZone: 'US/Pacific',
      }),
    ).toBe('Mon, Oct 5, 2026 at 7:00 PM PDT')
  })

  it('labels an Eastern send with its own zone', () => {
    expect(
      formatScheduledSend({
        date: new Date('2026-09-22T21:00:00Z'),
        scheduledLocalDate: '2026-09-22',
        scheduledLocalTime: '17:00',
        timeZone: 'US/Eastern',
      }),
    ).toBe('Tue, Sep 22, 2026 at 5:00 PM EDT')
  })

  it('returns undefined with nothing to render', () => {
    expect(
      formatScheduledSend({
        date: null,
        scheduledLocalDate: null,
        scheduledLocalTime: null,
        timeZone: 'US/Eastern',
      }),
    ).toBeUndefined()
  })
})
