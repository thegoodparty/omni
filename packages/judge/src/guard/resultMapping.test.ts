import { describe, expect, it } from 'vitest'
import { mapGuardOutcome, worstOutcome } from './resultMapping'

describe('mapGuardOutcome', () => {
  it.each([
    ['no_suite_reached', 'success'],
    ['BETTER', 'neutral'],
    ['NO DIFFERENCE FOUND', 'neutral'],
    ['WORSE', 'neutral'],
    ["CAN'T JUDGE", 'neutral'],
    ['judge crashed', 'neutral'],
  ] as const)('maps %s to conclusion %s', (outcome, conclusion) => {
    expect(mapGuardOutcome(outcome).conclusion).toBe(conclusion)
  })

  it('never maps any outcome to failure', () => {
    for (const outcome of [
      'no_suite_reached',
      'BETTER',
      'NO DIFFERENCE FOUND',
      'WORSE',
      "CAN'T JUDGE",
      'judge crashed',
    ] as const) {
      expect(['success', 'neutral']).toContain(
        mapGuardOutcome(outcome).conclusion,
      )
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
