import { describe, expect, it } from 'vitest'
import { planEndsAt, planLastDay } from './PlanEndsAt'

describe('planEndsAt', () => {
  it('prefers the override over the election date', () => {
    const override = new Date('2027-01-05T00:00:00Z')
    expect(
      planEndsAt({
        planEndsAtOverride: override,
        details: { electionDate: '2026-11-03' },
      }),
    ).toEqual(override)
  })

  it('is the election date plus 14 days, in UTC', () => {
    expect(
      planEndsAt({
        planEndsAtOverride: null,
        details: { electionDate: '2026-11-03' },
      }),
    ).toEqual(new Date('2026-11-17T00:00:00Z'))
  })

  it('is null with no override and no election date', () => {
    expect(planEndsAt({ details: {} })).toBeNull()
    expect(planEndsAt({ details: null })).toBeNull()
  })

  it('is null for an unparseable election date', () => {
    expect(planEndsAt({ details: { electionDate: 'not a date' } })).toBeNull()
  })
})

describe('planLastDay', () => {
  it('is the day before a midnight end', () => {
    expect(planLastDay('2027-01-30T00:00:00Z')).toEqual(
      new Date('2027-01-29T23:59:59.999Z'),
    )
  })

  it('keeps a staff end-of-day override on its own day', () => {
    expect(planLastDay(new Date('2027-01-05T23:59:59Z')).toISOString()).toMatch(
      /^2027-01-05/,
    )
  })
})
