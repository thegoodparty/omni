import { describe, it, expect } from 'vitest'
import { isHeldOffice } from './eligibility.util'
import { ElectedOffice } from '../../generated/prisma'

const office = (overrides: Partial<ElectedOffice>): ElectedOffice =>
  ({ isActive: true, termEndDate: null, ...overrides }) as ElectedOffice

describe('isHeldOffice', () => {
  it('is held the day before the exclusive term-end boundary', () => {
    // termEndDate is the half-open exclusive boundary (successor's start day);
    // the holder is still in office the day before it.
    const termEndDate = new Date('2026-06-30T00:00:00.000Z')
    const now = new Date('2026-06-29T18:00:00.000Z')

    expect(isHeldOffice(office({ termEndDate }), now)).toBe(true)
  })

  it('is not held once the term-end boundary day arrives', () => {
    // On the boundary day the successor has taken over, so the office is past.
    const termEndDate = new Date('2026-06-30T00:00:00.000Z')
    const now = new Date('2026-06-30T00:01:00.000Z')

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
