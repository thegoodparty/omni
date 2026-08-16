import { describe, it, expect } from 'vitest'
import { LOAD_SCENARIOS, scenarioCase } from './loadScenarios'

describe('LOAD_SCENARIOS', () => {
  it('targets the pool ceiling (50) with a zero error budget and sweeps past it', () => {
    expect(LOAD_SCENARIOS.length).toBeGreaterThan(0)
    for (const s of LOAD_SCENARIOS) {
      expect(s.targetConcurrency).toBe(50)
      expect(s.maxErrorRate).toBe(0)
      // a level above the pool so the over-saturation cliff stays visible
      expect(s.concurrencyLevels.some((c) => c > s.targetConcurrency)).toBe(
        true,
      )
    }
  })

  it('loads the join-path mega cohort, not just the no-join statewide one', () => {
    // statewide takes useVoterOnlyPath and skips the DistrictVoter join, so on
    // its own it does not exercise the path that 504s in production.
    const counts = LOAD_SCENARIOS.filter((s) => s.queryType === 'count')
    expect(counts.map((s) => s.band)).toContain('mega')
  })

  it('sweeps a level at the real lists-page fan-out (one request per saved list)', () => {
    const mega = LOAD_SCENARIOS.find((s) => s.id === 'load:count:mega')
    expect(mega?.concurrencyLevels).toContain(10)
  })

  it('resolves each scenario to a runnable case', () => {
    for (const s of LOAD_SCENARIOS) {
      const c = scenarioCase(s)
      expect(c.queryType).toBe(s.queryType)
      expect(c.cohort.band).toBe(s.band)
    }
  })
})
