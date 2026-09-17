import { describe, expect, it } from 'vitest'
import { format } from 'date-fns'
import { shortOutreachDate } from './outreachDate.util'

describe('shortOutreachDate', () => {
  it('formats a real send instant in the viewer timezone, not +8h', () => {
    // dateUsHelper's +8h shim rendered this as the next day ("Sep 8") for
    // any viewer west of UTC — the send is Sep 7 in every US timezone.
    const local = format(new Date('2026-09-07T23:00:00.000Z'), 'MMM d')
    expect(shortOutreachDate('2026-09-07T23:00:00.000Z')).toBe(local)
  })

  it('keeps the UTC calendar day for legacy midnight-UTC (date-only) rows', () => {
    expect(shortOutreachDate('2026-09-07T00:00:00.000Z')).toBe('Sep 7')
    expect(shortOutreachDate('2026-09-07')).toBe('Sep 7')
  })

  it('formats Date instances directly', () => {
    const date = new Date(2026, 8, 7, 12, 0)
    expect(shortOutreachDate(date)).toBe('Sep 7')
  })
})
