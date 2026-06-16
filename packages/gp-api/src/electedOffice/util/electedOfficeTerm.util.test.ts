import { describe, expect, it } from 'vitest'
import { deriveTermFields } from './electedOfficeTerm.util'

describe('deriveTermFields', () => {
  const electionDate = '2024-11-05T00:00:00.000Z'

  it('derives a 4-year term from a single-element [4] cadence', () => {
    const result = deriveTermFields({ frequency: [4], electionDate })

    expect(result.electedDate).toEqual(new Date(electionDate))
    expect(result.termStartAt).toEqual(new Date(electionDate))
    expect(result.termEndAt).toEqual(new Date('2028-11-05T00:00:00.000Z'))
    // 2024-11 → 2028-11 spans the 2028 leap day: 365 * 4 + 1.
    expect(result.termLengthDays).toBe(1461)
  })

  it('derives a 2-year term from a single-element [2] cadence', () => {
    const result = deriveTermFields({ frequency: [2], electionDate })

    expect(result.termEndAt).toEqual(new Date('2026-11-05T00:00:00.000Z'))
    expect(result.termLengthDays).toBe(730)
  })

  it('takes the longest gap for a staggered [2, 4] cadence, not frequency[0]', () => {
    const result = deriveTermFields({ frequency: [2, 4], electionDate })

    // Naively reading frequency[0] would give a 2-year term; the rule takes
    // max() so a [2, 4] office lands on the same 4-year horizon as [4].
    expect(result.termEndAt).toEqual(new Date('2028-11-05T00:00:00.000Z'))
    expect(result.termLengthDays).toBe(1461)
  })

  it('prefers swornInDate over the election date for term start', () => {
    const swornInDate = new Date('2025-01-06T00:00:00.000Z')
    const result = deriveTermFields({
      frequency: [4],
      electionDate,
      swornInDate,
    })

    expect(result.electedDate).toEqual(new Date(electionDate))
    expect(result.termStartAt).toEqual(swornInDate)
    expect(result.termEndAt).toEqual(new Date('2029-01-06T00:00:00.000Z'))
  })

  it('leaves term-length fields null when no frequency is available', () => {
    const result = deriveTermFields({ frequency: [], electionDate })

    expect(result.electedDate).toEqual(new Date(electionDate))
    expect(result.termStartAt).toEqual(new Date(electionDate))
    expect(result.termEndAt).toBeNull()
    expect(result.termLengthDays).toBeNull()
  })

  it('treats a non-positive cadence as no derivable term', () => {
    const result = deriveTermFields({ frequency: [0], electionDate })

    expect(result.termEndAt).toBeNull()
    expect(result.termLengthDays).toBeNull()
  })

  it('returns all-null term fields when neither swornInDate nor election date exist', () => {
    const result = deriveTermFields({ frequency: [4], electionDate: null })

    expect(result.electedDate).toBeNull()
    expect(result.termStartAt).toBeNull()
    expect(result.termEndAt).toBeNull()
    expect(result.termLengthDays).toBeNull()
  })
})
