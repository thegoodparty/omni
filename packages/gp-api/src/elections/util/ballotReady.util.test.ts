import { describe, expect, it } from 'vitest'
import {
  earliestDate,
  getMonthBounds,
  latestDate,
  toWindow,
} from './ballotReady.util'

// BR's Milestone.date is an `ISO8601Date` calendar string (yyyy-MM-dd, no
// time component). These helpers operate on that shape; getMonthBounds also
// accepts the election-date strings passed through from RacesByZipcode.

describe('toWindow', () => {
  it('returns null when the bucket is undefined', () => {
    expect(toWindow(undefined)).toBeNull()
  })

  it('returns null when both opens and closes are empty', () => {
    expect(toWindow({ opens: [], closes: [] })).toBeNull()
  })

  it('returns an open-only window with a null end', () => {
    expect(toWindow({ opens: ['2026-08-20'], closes: [] })).toEqual({
      start: '2026-08-20',
      end: null,
    })
  })

  it('returns a close-only window with a null start', () => {
    expect(toWindow({ opens: [], closes: ['2026-08-30'] })).toEqual({
      start: null,
      end: '2026-08-30',
    })
  })

  it('picks earliest open and latest close from unsorted input', () => {
    expect(
      toWindow({
        opens: ['2026-10-25', '2026-10-20', '2026-10-22'],
        closes: ['2026-11-01', '2026-11-03', '2026-11-02'],
      }),
    ).toEqual({ start: '2026-10-20', end: '2026-11-03' })
  })
})

describe('getMonthBounds', () => {
  it('returns first and last calendar day of a mid-month date', () => {
    expect(getMonthBounds('2026-03-15')).toEqual({
      gt: '2026-03-01',
      lt: '2026-03-31',
    })
  })

  it('handles a date already on the first of the month', () => {
    expect(getMonthBounds('2026-03-01')).toEqual({
      gt: '2026-03-01',
      lt: '2026-03-31',
    })
  })

  it('handles a date already on the last of the month', () => {
    expect(getMonthBounds('2026-12-31')).toEqual({
      gt: '2026-12-01',
      lt: '2026-12-31',
    })
  })

  it('returns the correct short month length for February (non-leap year)', () => {
    expect(getMonthBounds('2026-02-15')).toEqual({
      gt: '2026-02-01',
      lt: '2026-02-28',
    })
  })

  it('returns the correct February length in a leap year', () => {
    expect(getMonthBounds('2024-02-10')).toEqual({
      gt: '2024-02-01',
      lt: '2024-02-29',
    })
  })
})

describe('earliestDate', () => {
  it('returns null for an empty list', () => {
    expect(earliestDate([])).toBeNull()
  })

  it('returns the only value for a single-element list', () => {
    expect(earliestDate(['2026-05-01'])).toBe('2026-05-01')
  })

  it('returns the chronologically earliest value from unsorted input', () => {
    expect(earliestDate(['2026-05-10', '2026-01-02', '2026-03-20'])).toBe(
      '2026-01-02',
    )
  })
})

describe('latestDate', () => {
  it('returns null for an empty list', () => {
    expect(latestDate([])).toBeNull()
  })

  it('returns the only value for a single-element list', () => {
    expect(latestDate(['2026-05-01'])).toBe('2026-05-01')
  })

  it('returns the chronologically latest value from unsorted input', () => {
    expect(latestDate(['2026-05-10', '2026-12-02', '2026-03-20'])).toBe(
      '2026-12-02',
    )
  })
})
