import { describe, it, expect } from 'vitest'
import { buildLatencyCases } from './cases'

describe('buildLatencyCases', () => {
  const cases = buildLatencyCases()

  it('applies list and count across every cohort x variant, others once per cohort', () => {
    // list: 4x6, count: 4x6, then search/sample/overlap/csv/stats: 4 each
    expect(cases.length).toBe(24 + 24 + 4 * 5)
  })

  it('runs stats once per cohort with the none variant only', () => {
    const stats = cases.filter((c) => c.queryType === 'stats')
    expect(stats.length).toBe(4)
    expect(stats.every((c) => c.variant.name === 'none')).toBe(true)
  })

  it('down-samples the heavy statewide list/csv cells to fewer iterations', () => {
    const heavy = cases.filter(
      (c) =>
        c.cohort.band === 'statewide' &&
        (c.queryType === 'csv' ||
          (c.queryType === 'list' &&
            c.variant.name === 'broad-lowselectivity')),
    )
    expect(heavy.length).toBeGreaterThan(0)
    expect(heavy.every((c) => c.iterations <= 2)).toBe(true)
  })

  it('gives every case a unique id', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
  })
})
