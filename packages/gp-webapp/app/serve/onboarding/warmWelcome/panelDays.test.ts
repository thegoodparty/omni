import { describe, expect, it } from 'vitest'
import {
  canSendOn,
  earliestSend,
  readyWeekLabel,
  sendDayLong,
  sendHourLabel,
  sendOptions,
} from './panelDays'

// Wednesday, November 25, 2026
const WEDNESDAY = new Date(2026, 10, 25)
// Friday, November 27, 2026
const FRIDAY = new Date(2026, 10, 27)

const options = (today: Date, swornIn: Date | null = null) =>
  sendOptions({ today, swornIn, sendHour: 11, maxDaysOut: 89 })

describe('earliestSend', () => {
  it('is tomorrow on a weekday', () => {
    expect(earliestSend(WEDNESDAY)).toEqual(new Date(2026, 10, 26))
  })

  it('is Monday when tomorrow is a weekend day', () => {
    expect(earliestSend(FRIDAY)).toEqual(new Date(2026, 10, 30))
  })
})

describe('sendOptions', () => {
  it('offers tomorrow, the next Tuesday or Thursday, and any day', () => {
    expect(options(WEDNESDAY)).toEqual([
      {
        key: 'first',
        label: 'Tomorrow',
        sub: 'Thu, Nov 26 at 11 am',
        date: new Date(2026, 10, 26),
      },
      {
        key: 'weekday',
        label: 'Tuesday',
        sub: 'Tue, Dec 1 at 11 am',
        date: new Date(2026, 11, 1),
      },
      { key: 'pick', label: 'Pick a day', sub: 'Any day at 11 am', date: null },
    ])
  })

  it('calls the first day Monday after a weekend', () => {
    const [first, weekday] = options(FRIDAY)
    expect(first).toMatchObject({
      label: 'Monday',
      date: new Date(2026, 10, 30),
    })
    expect(weekday).toMatchObject({
      label: 'Tuesday',
      date: new Date(2026, 11, 1),
    })
  })

  it('offers "After I’m sworn in" when that day is later and within reach', () => {
    const sworn = options(WEDNESDAY, new Date(2027, 0, 4)).find(
      (option) => option.key === 'sworn',
    )
    expect(sworn).toEqual({
      key: 'sworn',
      label: 'After I’m sworn in',
      sub: 'Mon, Jan 4 at 11 am',
      date: new Date(2027, 0, 4),
    })
  })

  it('moves a weekend swearing-in to the Monday after', () => {
    // Saturday, January 2, 2027
    const sworn = options(WEDNESDAY, new Date(2027, 0, 2)).find(
      (option) => option.key === 'sworn',
    )
    expect(sworn?.date).toEqual(new Date(2027, 0, 4))
    expect(sworn?.sub).toBe('Mon, Jan 4 at 11 am')
  })

  it('leaves it out when they are sworn in before the weekday on offer', () => {
    expect(
      options(WEDNESDAY, new Date(2026, 10, 30)).map((option) => option.key),
    ).toEqual(['first', 'weekday', 'pick'])
  })

  it('leaves it out when it is further off than invites can be set', () => {
    expect(
      options(WEDNESDAY, new Date(2027, 2, 15)).map((option) => option.key),
    ).toEqual(['first', 'weekday', 'pick'])
  })
})

describe('canSendOn', () => {
  it('takes a weekday from tomorrow up to the limit', () => {
    expect(canSendOn(new Date(2026, 10, 26), WEDNESDAY, 89)).toBe(true)
    expect(canSendOn(new Date(2027, 1, 22), WEDNESDAY, 89)).toBe(true)
  })

  it('refuses today, a weekend and a day past the limit', () => {
    expect(canSendOn(WEDNESDAY, WEDNESDAY, 89)).toBe(false)
    expect(canSendOn(new Date(2026, 10, 28), WEDNESDAY, 89)).toBe(false)
    expect(canSendOn(new Date(2027, 1, 23), WEDNESDAY, 89)).toBe(false)
  })
})

describe('how the days read', () => {
  it('writes the hour, the day, and the week the panel is ready', () => {
    expect(sendHourLabel(11)).toBe('11 am')
    expect(sendHourLabel(13)).toBe('1 pm')
    expect(sendDayLong(new Date(2026, 11, 1))).toBe('Tuesday, December 1')
    // Two weeks of waves from December 1 end on the 15th; the Monday of
    // that week is the 14th.
    expect(readyWeekLabel(new Date(2026, 11, 1))).toBe('December 14')
  })
})
