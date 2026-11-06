import { describe, expect, it } from 'vitest'
import { mapGuardOutcome, worstOutcome } from './resultMapping'

describe('mapGuardOutcome', () => {
  it.each([
    ['no_agent_reached', 'success'],
    ['BETTER', 'success'],
    ['SAME', 'success'],
    ['WORSE', 'neutral'],
    ["CAN'T SAY", 'success'],
    ['infra_error', 'neutral'],
  ] as const)('maps %s to conclusion %s', (outcome, conclusion) => {
    expect(mapGuardOutcome(outcome).conclusion).toBe(conclusion)
  })

  it('flags WORSE for a ruling', () => {
    expect(mapGuardOutcome('WORSE').note).toMatch(/ruling/)
  })

  it("notes CAN'T SAY rather than passing silently", () => {
    expect(mapGuardOutcome("CAN'T SAY").note.length).toBeGreaterThan(0)
  })

  it('notes an infra error without claiming an alert nothing sends', () => {
    expect(mapGuardOutcome('infra_error').note).toMatch(/infra error/)
    expect(mapGuardOutcome('infra_error').note).not.toMatch(/[Aa]lert/)
  })
})

describe('worstOutcome', () => {
  it('is no_agent_reached for an empty list', () => {
    expect(worstOutcome([])).toBe('no_agent_reached')
  })

  it('picks WORSE over SAME when agents disagree', () => {
    expect(worstOutcome(['SAME', 'WORSE'])).toBe('WORSE')
  })

  it('picks infra_error over WORSE', () => {
    expect(worstOutcome(['WORSE', 'infra_error'])).toBe('infra_error')
  })

  it("picks WORSE over CAN'T SAY", () => {
    expect(worstOutcome(["CAN'T SAY", 'WORSE'])).toBe('WORSE')
  })

  it("picks CAN'T SAY over a clean BETTER", () => {
    expect(worstOutcome(['BETTER', "CAN'T SAY"])).toBe("CAN'T SAY")
  })

  it('still passes when every agent is BETTER or SAME', () => {
    const outcome = worstOutcome(['SAME', 'BETTER'])
    expect(mapGuardOutcome(outcome).conclusion).toBe('success')
  })
})
