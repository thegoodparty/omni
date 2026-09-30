import { describe, expect, it } from 'vitest'
import { outreachChannel, outreachEventProps } from './outreachAnalytics'

// The omission rules are the whole point of this module: an absent property
// and a zero mean different things on every one of them, and a chart that
// averages `price` or sums `recipientCount` reads a 0 as a real measurement.
describe('outreachEventProps', () => {
  it('omits recipientCount entirely rather than sending 0', () => {
    const props = outreachEventProps({ channel: 'socialMedia', isServe: false })

    expect(props).not.toHaveProperty('recipientCount')
    expect(props.medium).toBe('socialMedia')
    expect(props.fanout).toBe('one-to-many')
  })

  it('keeps a real zero when one is passed', () => {
    expect(
      outreachEventProps({
        channel: 'text',
        isServe: false,
        recipientCount: 0,
      }),
    ).toEqual(expect.objectContaining({ recipientCount: 0 }))
  })

  it('omits price on a channel that has no cost, and keeps a paid zero', () => {
    expect(
      outreachEventProps({ channel: 'doorKnocking', isServe: false }),
    ).not.toHaveProperty('price')
    // A send fully covered by the free-texts offer is a zero-cost text
    // campaign, not a channel without a price.
    expect(
      outreachEventProps({ channel: 'text', isServe: false, price: 0 }),
    ).toEqual(expect.objectContaining({ price: 0 }))
  })

  it('marks the two one-to-one channels and nothing else', () => {
    expect(
      outreachEventProps({ channel: 'doorKnocking', isServe: false }).fanout,
    ).toBe('one-to-one')
    expect(
      outreachEventProps({ channel: 'phoneBanking', isServe: false }).fanout,
    ).toBe('one-to-one')
    expect(
      outreachEventProps({ channel: 'robocall', isServe: false }).fanout,
    ).toBe('one-to-many')
  })

  it('reduces sendDate to a date, because a send is scheduled by day', () => {
    expect(
      outreachEventProps({
        channel: 'text',
        isServe: false,
        sendDate: new Date('2026-09-29T18:30:00.000Z'),
      }).sendDate,
    ).toBe('2026-09-29')
    expect(
      outreachEventProps({
        channel: 'text',
        isServe: false,
        sendDate: '2026-09-29',
      }).sendDate,
    ).toBe('2026-09-29')
  })

  it('mirrors recipientCount as voterContacts, omission included', () => {
    const props = outreachEventProps({
      channel: 'text',
      isServe: false,
      recipientCount: 40,
    })
    expect(props.voterContacts).toBe(40)
    expect(
      outreachEventProps({ channel: 'socialMedia', isServe: false }),
    ).not.toHaveProperty('voterContacts')
  })

  it('cuts win from serve on a property rather than an event name', () => {
    expect(
      outreachEventProps({ channel: 'text', isServe: false }).product,
    ).toBe('win')
    expect(outreachEventProps({ channel: 'text', isServe: true }).product).toBe(
      'serve',
    )
  })

  // An evening in any US timezone is already tomorrow in UTC, so reducing a
  // Date with toISOString() reported a walk finished on the 29th as the 30th.
  it('reduces a Date to its local day, not its UTC one', () => {
    // 8pm on the 29th in a UTC-5 zone is 01:00 on the 30th UTC.
    const evening = new Date(2026, 8, 29, 20, 0, 0)
    expect(
      outreachEventProps({
        channel: 'doorKnocking',
        isServe: false,
        sendDate: evening,
      }).sendDate,
    ).toBe('2026-09-29')
  })

  it('carries a tracker origin as both halves or neither', () => {
    expect(
      outreachEventProps({ channel: 'text', isServe: false }),
    ).not.toHaveProperty('trackerTaskId')
    expect(
      outreachEventProps({
        channel: 'text',
        isServe: false,
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

  // The flow shell, the audience hook and the gate each named the channels
  // before this vocabulary existed, which is how one text send ended up with
  // four spellings across two properties.
  it("folds the surfaces' own spellings onto the same vocabulary", () => {
    expect(outreachChannel('sms')).toBe('text')
    expect(outreachChannel('texting')).toBe('text')
    expect(outreachChannel('social')).toBe('socialMedia')
    expect(outreachChannel('door')).toBe('doorKnocking')
    expect(outreachChannel('phone-bank')).toBe('phoneBanking')
    expect(outreachChannel('Phone Banking')).toBe('phoneBanking')
  })

  it('leaves an unknown type as the catch-all rather than dropping the event', () => {
    expect(outreachChannel('something-new')).toBe('general')
  })
})
