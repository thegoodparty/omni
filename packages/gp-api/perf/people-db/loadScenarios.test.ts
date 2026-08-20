import { describe, it, expect } from 'vitest'
import { LOAD_SCENARIOS, scenarioCase } from './loadScenarios'

describe('LOAD_SCENARIOS', () => {
  it('targets the pool ceiling (50) and sweeps past it', () => {
    expect(LOAD_SCENARIOS.length).toBeGreaterThan(0)
    for (const s of LOAD_SCENARIOS) {
      expect(s.targetConcurrency).toBe(50)
      expect(s.maxErrorRate).toBeGreaterThanOrEqual(0)
      expect(s.maxErrorRate).toBeLessThanOrEqual(1)
      // a level above the pool so the over-saturation cliff stays visible
      expect(s.concurrencyLevels.some((c) => c > s.targetConcurrency)).toBe(
        true,
      )
    }
  })

  it('keeps at least one scenario actually gating', () => {
    // Budgets are per-scenario so a known-broken band can be observation-only
    // (maxErrorRate: 1), but if every scenario were observation-only the load
    // gate would be decorative — runLoad could never exit non-zero.
    expect(LOAD_SCENARIOS.some((s) => s.maxErrorRate === 0)).toBe(true)
  })

  it('only lets the large band off the hook, and says why in a comment', () => {
    // large cold-runs past the 25s statement timeout, so a 0 budget there is a
    // permanent FAIL rather than a signal. Every other band must still gate.
    for (const s of LOAD_SCENARIOS) {
      if (s.maxErrorRate !== 0) expect(s.band).toBe('large')
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
      expect(c.variant).toBe(s.variant ?? c.variant)
    }
  })

  it('load-tests list-detail in the filtered shape that actually 504s', () => {
    // Every list-detail 504 in the week to 2026-08-16 was segment-scoped. An
    // unfiltered load gate can pass while the saved-list path saturates the
    // pool, so the variant must not quietly fall back to `none` here.
    const detail = LOAD_SCENARIOS.filter((s) => s.queryType === 'list-detail')
    expect(detail.length).toBeGreaterThan(0)
    for (const s of detail) {
      expect(scenarioCase(s).variant.name).not.toBe('none')
    }
  })
})
