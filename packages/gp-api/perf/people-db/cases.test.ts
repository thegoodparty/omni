import { describe, it, expect } from 'vitest'
import { buildLatencyCases, DEFAULT_ITERATIONS } from './cases'

describe('buildLatencyCases', () => {
  const cases = buildLatencyCases()

  it('applies list and count across every cohort x variant, others once per cohort', () => {
    // list: 4x6, count: 4x6, search/sample/overlap/stats/voterDensity: 4 each,
    // csv: 3 (csv skips statewide — a ~23M-row export would dominate the pass)
    expect(cases.length).toBe(24 + 24 + 4 * 5 + 3)
  })

  it('emits csv for every cohort except statewide', () => {
    const csv = cases.filter((c) => c.queryType === 'csv')
    expect(csv.length).toBe(3)
    expect(csv.some((c) => c.cohort.band === 'statewide')).toBe(false)
    expect(csv.every((c) => c.variant.name === 'none')).toBe(true)
  })

  it('runs stats once per cohort with the none variant only', () => {
    const stats = cases.filter((c) => c.queryType === 'stats')
    expect(stats.length).toBe(4)
    expect(stats.every((c) => c.variant.name === 'none')).toBe(true)
  })

  it('runs voterDensity once per cohort with the none variant only', () => {
    const density = cases.filter((c) => c.queryType === 'voterDensity')
    expect(density.length).toBe(4)
    expect(density.every((c) => c.variant.name === 'none')).toBe(true)
  })

  it('down-samples the heavy statewide list cell to fewer iterations', () => {
    const heavy = cases.filter(
      (c) =>
        c.cohort.band === 'statewide' &&
        c.queryType === 'list' &&
        c.variant.name === 'broad-lowselectivity',
    )
    expect(heavy.length).toBeGreaterThan(0)
    // down-sampled below the default, but still an aggregate (>= 3)
    expect(
      heavy.every(
        (c) => c.iterations < DEFAULT_ITERATIONS && c.iterations >= 3,
      ),
    ).toBe(true)
  })

  it('gives every case a unique id', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
  })
})
