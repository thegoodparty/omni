import { describe, it, expect } from 'vitest'
import { isHeldOffice } from './eligibility.util'
import { ElectedOffice } from '../../generated/prisma'

const office = (overrides: Partial<ElectedOffice>): ElectedOffice =>
  ({ isActive: true, termEndDate: null, ...overrides }) as ElectedOffice

describe('isHeldOffice', () => {
  it('is held through the entire term-end calendar day (UTC)', () => {
    // termEndDate is a DATE column stored at UTC midnight; the office must
    // still count as held later on that same calendar day.
    const termEndDate = new Date('2026-06-30T00:00:00.000Z')
    const now = new Date('2026-06-30T18:00:00.000Z')

    expect(isHeldOffice(office({ termEndDate }), now)).toBe(true)
  })

  it('is not held the day after the term ends', () => {
    const termEndDate = new Date('2026-06-30T00:00:00.000Z')
    const now = new Date('2026-07-01T00:00:00.000Z')

    expect(isHeldOffice(office({ termEndDate }), now)).toBe(false)
  })

  it('is held when the term end is null and the office is active', () => {
    expect(isHeldOffice(office({ termEndDate: null }), new Date())).toBe(true)
  })

  it('is not held when the office is inactive', () => {
    expect(
      isHeldOffice(office({ isActive: false, termEndDate: null }), new Date()),
    ).toBe(false)
  })
})
