import { describe, expect, it } from 'vitest'
import { SMS_CUTOFF_COPY, formatSmsCutoffDate } from './verificationCopy'

describe('formatSmsCutoffDate', () => {
  it.each([
    ['2026-01-05', 'Jan. 5'],
    ['2026-02-28', 'Feb. 28'],
    ['2026-03-04', 'March 4'],
    ['2026-04-01', 'April 1'],
    ['2026-05-19', 'May 19'],
    ['2026-06-30', 'June 30'],
    ['2026-07-04', 'July 4'],
    ['2026-08-12', 'Aug. 12'],
    ['2026-09-03', 'Sept. 3'],
    ['2026-10-15', 'Oct. 15'],
    ['2026-11-03', 'Nov. 3'],
    ['2026-12-31', 'Dec. 31'],
  ])('formats %s as %s', (isoDate, expected) => {
    expect(formatSmsCutoffDate(isoDate)).toBe(expected)
  })

  it('reads only the day of a full ISO timestamp', () => {
    expect(formatSmsCutoffDate('2026-10-15T23:59:59.000Z')).toBe('Oct. 15')
  })
})

describe('SMS_CUTOFF_COPY.closedReason', () => {
  it('names the cutoff date when there is one', () => {
    expect(SMS_CUTOFF_COPY.closedReason('Oct. 15')).toBe(
      'The Oct. 15 deadline to get verified for texting has passed.',
    )
  })

  it('still reads as a sentence without a date', () => {
    expect(SMS_CUTOFF_COPY.closedReason(null)).toBe(
      'The deadline to get verified for texting has passed.',
    )
  })
})
