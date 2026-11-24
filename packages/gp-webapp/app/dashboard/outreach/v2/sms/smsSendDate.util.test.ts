import { describe, expect, it } from 'vitest'
import { seedSendDate } from './smsSendDate.util'

const NOW = new Date(2026, 9, 1, 12, 0).getTime()

describe('seedSendDate', () => {
  it('reads a future day as that local day', () => {
    const day = seedSendDate('2026-10-06', NOW)
    expect(day?.getFullYear()).toBe(2026)
    expect(day?.getMonth()).toBe(9)
    expect(day?.getDate()).toBe(6)
    expect(day?.getHours()).toBe(0)
  })

  it('takes the earliest day the picker allows', () => {
    expect(seedSendDate('2026-10-03', NOW)).toBeDefined()
  })

  it('ignores a past day and one inside the 48-hour floor', () => {
    expect(seedSendDate('2026-09-20', NOW)).toBeUndefined()
    expect(seedSendDate('2026-10-01', NOW)).toBeUndefined()
    expect(seedSendDate('2026-10-02', NOW)).toBeUndefined()
  })

  it('ignores an invalid or absent date', () => {
    expect(seedSendDate('2026-02-31', NOW)).toBeUndefined()
    expect(seedSendDate('next Tuesday', NOW)).toBeUndefined()
    expect(seedSendDate('2026-10-06T10:00:00Z', NOW)).toBeUndefined()
    expect(seedSendDate(undefined, NOW)).toBeUndefined()
    expect(seedSendDate('', NOW)).toBeUndefined()
  })
})
