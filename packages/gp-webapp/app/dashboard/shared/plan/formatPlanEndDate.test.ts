import { afterEach, describe, expect, it } from 'vitest'
import { formatPlanEndDate } from './formatPlanEndDate'

describe('formatPlanEndDate', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    process.env.TZ = originalTz
  })

  it.each(['America/Los_Angeles', 'Asia/Tokyo'])(
    'shows the day before a UTC-midnight end in %s',
    (tz) => {
      process.env.TZ = tz
      expect(formatPlanEndDate('2027-01-30T00:00:00Z')).toBe('Jan 29, 2027')
      expect(formatPlanEndDate('2027-01-30T00:00:00Z', 'long')).toBe(
        'January 29, 2027',
      )
    },
  )
})
