import { describe, it, expect } from 'vitest'
import {
  deriveIsActive,
  deriveTermLengthDays,
  electedOfficeToApi,
} from './electedOffice.util'
import { ElectedOffice } from '../../generated/prisma'

describe('deriveIsActive', () => {
  const now = new Date('2026-06-15T00:00:00.000Z')

  it('is active while now is before the exclusive term end', () => {
    expect(deriveIsActive(new Date('2026-06-16T00:00:00.000Z'), now)).toBe(true)
  })

  it('is inactive on/after the exclusive term-end boundary', () => {
    expect(deriveIsActive(new Date('2026-06-15T00:00:00.000Z'), now)).toBe(
      false,
    )
    expect(deriveIsActive(new Date('2020-01-01T00:00:00.000Z'), now)).toBe(
      false,
    )
  })

  it('is inactive when the term end date is missing', () => {
    expect(deriveIsActive(null, now)).toBe(false)
  })
})

describe('deriveTermLengthDays', () => {
  it('is the calendar-day span across a 4-year term (incl. leap day)', () => {
    expect(
      deriveTermLengthDays(
        new Date('2025-01-01T00:00:00.000Z'),
        new Date('2029-01-01T00:00:00.000Z'),
      ),
    ).toBe(1461)
  })

  it('is null when either bound is missing', () => {
    expect(deriveTermLengthDays(null, new Date('2029-01-01'))).toBeNull()
    expect(deriveTermLengthDays(new Date('2025-01-01'), null)).toBeNull()
    expect(deriveTermLengthDays(null, null)).toBeNull()
  })
})

describe('electedOfficeToApi', () => {
  const base: ElectedOffice = {
    id: 'eo-1',
    organizationSlug: 'eo-eo-1',
    swornInDate: new Date('2025-01-06T00:00:00.000Z'),
    electedDate: new Date('2024-11-05T00:00:00.000Z'),
    termStartDate: new Date('2025-01-01T00:00:00.000Z'),
    termEndDate: new Date('2029-01-01T00:00:00.000Z'),
    party: 'Independent',
    pledgedAt: new Date('2026-02-01T00:00:00.000Z'),
    onboardingCompletedAt: null,
    selfReported: false,
    onboardingStep: null,
    userId: 7,
    campaignId: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
  } as ElectedOffice

  it('emits derived isActive + termLengthDays alongside date-only strings', () => {
    const now = new Date('2026-06-15T00:00:00.000Z')
    const api = electedOfficeToApi(base, now)

    expect(api.isActive).toBe(true)
    expect(api.termLengthDays).toBe(1461)
    expect(api.selfReported).toBe(false)
    expect(
      electedOfficeToApi({ ...base, selfReported: true }, now).selfReported,
    ).toBe(true)
    // The resume checkpoint passes straight through to the API shape.
    expect(api.onboardingStep).toBeNull()
    expect(
      electedOfficeToApi({ ...base, onboardingStep: 'term-dates' }, now)
        .onboardingStep,
    ).toBe('term-dates')
    expect(api.termStartDate).toBe('2025-01-01')
    expect(api.termEndDate).toBe('2029-01-01')
  })

  it('derives inactive when the term end has passed or is missing', () => {
    const now = new Date('2030-06-15T00:00:00.000Z')
    expect(electedOfficeToApi(base, now).isActive).toBe(false)

    const noEnd = { ...base, termEndDate: null } as ElectedOffice
    expect(electedOfficeToApi(noEnd, now).isActive).toBe(false)
    expect(electedOfficeToApi(noEnd, now).termLengthDays).toBeNull()
  })
})
