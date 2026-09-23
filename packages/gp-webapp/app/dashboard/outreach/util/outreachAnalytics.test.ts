import { describe, expect, it } from 'vitest'
import { outreachChannel, outreachEventProps } from './outreachAnalytics'

// The omission rules are the whole point of this module: an absent property
// and a zero mean different things on every one of them, and a chart that
// averages `price` or sums `recipientCount` reads a 0 as a real measurement.
describe('outreachEventProps', () => {
  it('omits recipientCount entirely rather than sending 0', () => {
    const props = outreachEventProps({ channel: 'socialMedia' })

    expect(props).not.toHaveProperty('recipientCount')
    expect(props.medium).toBe('socialMedia')
    expect(props.fanout).toBe('one-to-many')
  })

  it('keeps a real zero when one is passed', () => {
    expect(outreachEventProps({ channel: 'text', recipientCount: 0 })).toEqual(
      expect.objectContaining({ recipientCount: 0 }),
    )
  })

  it('omits price on a channel that has no cost, and keeps a paid zero', () => {
    expect(outreachEventProps({ channel: 'doorKnocking' })).not.toHaveProperty(
      'price',
    )
    // A send fully covered by the free-texts offer is a zero-cost text
    // campaign, not a channel without a price.
    expect(outreachEventProps({ channel: 'text', price: 0 })).toEqual(
      expect.objectContaining({ price: 0 }),
    )
  })

  it('marks the two one-to-one channels and nothing else', () => {
    expect(outreachEventProps({ channel: 'doorKnocking' }).fanout).toBe(
      'one-to-one',
    )
    expect(outreachEventProps({ channel: 'phoneBanking' }).fanout).toBe(
      'one-to-one',
    )
    expect(outreachEventProps({ channel: 'robocall' }).fanout).toBe(
      'one-to-many',
    )
  })

  it('reduces sendDate to a date, because a send is scheduled by day', () => {
    expect(
      outreachEventProps({
        channel: 'text',
        sendDate: new Date('2026-09-29T18:30:00.000Z'),
      }).sendDate,
    ).toBe('2026-09-29')
    expect(
      outreachEventProps({ channel: 'text', sendDate: '2026-09-29' }).sendDate,
    ).toBe('2026-09-29')
  })

  it('carries a tracker origin as both halves or neither', () => {
    expect(outreachEventProps({ channel: 'text' })).not.toHaveProperty(
      'trackerTaskId',
    )
    expect(
      outreachEventProps({
        channel: 'text',
        tracker: { trackerTaskId: 'task_1', phase: 'gotv' },
      }),
    ).toEqual(
      expect.objectContaining({ trackerTaskId: 'task_1', phase: 'gotv' }),
    )
  })
})

// The cross-walk exists because the analytics vocabulary is the campaign
// tracker's `TaskChannel` and the flows speak `OutreachType`. These four are
// where the two disagree; everything else passes through.
describe('outreachChannel', () => {
  it('folds the OutreachType spellings onto the tracker vocabulary', () => {
    expect(outreachChannel('p2p')).toBe('text')
    expect(outreachChannel('nativeDoorKnocking')).toBe('doorKnocking')
    expect(outreachChannel('nativePhoneBanking')).toBe('phoneBanking')
    expect(outreachChannel('events')).toBe('event')
  })

  it('leaves an unknown type as the catch-all rather than dropping the event', () => {
    expect(outreachChannel('something-new')).toBe('general')
  })
})
