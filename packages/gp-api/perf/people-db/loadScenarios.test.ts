import { describe, it, expect } from 'vitest'
import { LOAD_SCENARIOS, scenarioCase } from './loadScenarios'

describe('LOAD_SCENARIOS', () => {
  it('targets the pool ceiling with a 25-level and a zero error budget', () => {
    expect(LOAD_SCENARIOS.length).toBeGreaterThan(0)
    for (const s of LOAD_SCENARIOS) {
      expect(s.concurrencyLevels).toContain(25)
      expect(s.targetConcurrency).toBe(25)
      expect(s.maxErrorRate).toBe(0)
    }
  })

  it('resolves each scenario to a runnable case', () => {
    for (const s of LOAD_SCENARIOS) {
      const c = scenarioCase(s)
      expect(c.queryType).toBe(s.queryType)
      expect(c.cohort.band).toBe(s.band)
    }
  })
})
