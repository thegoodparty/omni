import { describe, expect, it } from 'vitest'
import { localDay, todayLine } from './todayLine'

const NOON_UTC = new Date('2026-10-05T12:00:00.000Z')

describe('todayLine', () => {
  it('names the weekday, the date and the zone for the state', () => {
    expect(todayLine('IL', NOON_UTC)).toBe(
      'Today is Monday, October 5, 2026 (Central Time).',
    )
  })

  it('falls back to Eastern when the state is missing or unknown', () => {
    expect(todayLine(null, NOON_UTC)).toBe(
      'Today is Monday, October 5, 2026 (Eastern Time).',
    )
    expect(todayLine('XX', NOON_UTC)).toBe(
      'Today is Monday, October 5, 2026 (Eastern Time).',
    )
  })

  it('keeps the local date after UTC has rolled over to the next day', () => {
    // 11:30pm in New York on the 5th is 03:30 UTC on the 6th.
    const lateEvening = new Date('2026-10-06T03:30:00.000Z')
    expect(todayLine('NY', lateEvening)).toContain('Monday, October 5, 2026')
    expect(todayLine('CA', lateEvening)).toContain('Monday, October 5, 2026')
  })

  it('formats every zone the state table can answer with', () => {
    for (const state of ['NY', 'IL', 'CO', 'CA', 'AK', 'AZ', 'HI']) {
      expect(todayLine(state, NOON_UTC)).toMatch(
        /^Today is \w+, \w+ \d{1,2}, \d{4} \(\w+ Time\)\.$/,
      )
    }
  })
})

describe('localDay', () => {
  it('gives the day in the state zone, not the server day', () => {
    // 03:30 UTC on the 6th is still the evening of the 5th across the US.
    const late = new Date('2026-10-06T03:30:00.000Z')
    expect(localDay('IL', late)).toBe('2026-10-05')
    expect(localDay('CA', late)).toBe('2026-10-05')
    expect(localDay(null, late)).toBe('2026-10-05')
    expect(localDay('IL', new Date('2026-10-06T12:00:00.000Z'))).toBe(
      '2026-10-06',
    )
  })
})
