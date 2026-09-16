import { describe, expect, it } from 'vitest'
import { TIME_OPTIONS } from './SmsScheduleStep'

// The chosen time is the Peerly window START and the window always closes
// at the 9 PM compliance cutoff, so the last bookable slot is 8 PM — a
// 9 PM start would leave a zero-width send window.
describe('TIME_OPTIONS', () => {
  it('offers hourly slots from 9 AM through 8 PM plus a custom entry', () => {
    const hourly = TIME_OPTIONS.filter((o) => o.time !== null)
    expect(hourly[0]).toMatchObject({ label: '9:00 AM', time: '09:00' })
    expect(hourly.at(-1)).toMatchObject({ label: '8:00 PM', time: '20:00' })
    expect(hourly).toHaveLength(12)
    expect(TIME_OPTIONS.at(-1)).toMatchObject({ id: 'custom', time: null })
  })

  it('never offers a slot at or past the 9 PM window close', () => {
    expect(TIME_OPTIONS.some((o) => o.time === '21:00')).toBe(false)
  })
})
