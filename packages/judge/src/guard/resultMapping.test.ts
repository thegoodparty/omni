import { describe, expect, it } from 'vitest'
import { mapGuardOutcome, worstOutcome } from './resultMapping'

describe('mapGuardOutcome', () => {
  it('words every outcome', () => {
    for (const outcome of [
      'no_suite_reached',
      'BETTER',
      'NO DIFFERENCE FOUND',
      'WORSE',
      "CAN'T JUDGE",
      'judge crashed',
    ] as const) {
      expect(mapGuardOutcome(outcome).note.length).toBeGreaterThan(0)
    }
  })
})

describe('worstOutcome', () => {
  it('is no_suite_reached for an empty list', () => {
    expect(worstOutcome([])).toBe('no_suite_reached')
  })

  it("ranks a crash above WORSE above CAN'T JUDGE above the rest", () => {
    expect(worstOutcome(['BETTER', 'WORSE', 'judge crashed'])).toBe(
      'judge crashed',
    )
    expect(worstOutcome(['BETTER', "CAN'T JUDGE", 'WORSE'])).toBe('WORSE')
    expect(worstOutcome(['NO DIFFERENCE FOUND', "CAN'T JUDGE"])).toBe(
      "CAN'T JUDGE",
    )
    expect(worstOutcome(['BETTER', 'NO DIFFERENCE FOUND'])).toBe(
      'NO DIFFERENCE FOUND',
    )
  })
})
