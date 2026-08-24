import { describe, it, expect } from 'vitest'
import { buildLatencyCases, DEFAULT_ITERATIONS } from './cases'

describe('buildLatencyCases', () => {
  const cases = buildLatencyCases()

  it('applies list and count across every cohort x variant, others once per cohort', () => {
    // list: 5x11, count: 5x11, list-detail: 5x2, search/sample/overlap/stats/
    // voterDensity: 5 each, csv: 3 (csv skips mega and statewide — they
    // dominate the pass)
    expect(cases.length).toBe(55 + 55 + 10 + 5 * 5 + 3)
  })

  it('latency-tests the whole list-detail request at every district size', () => {
    const detail = cases.filter((c) => c.queryType === 'list-detail')
    // every band, not just the ones the load scenarios target
    expect(new Set(detail.map((c) => c.cohort.band))).toEqual(
      new Set(['small', 'medium', 'large', 'mega', 'statewide']),
    )
    // both ways the sheet opens: universe row and a saved list
    for (const band of ['small', 'medium', 'large', 'mega', 'statewide']) {
      const forBand = detail.filter((c) => c.cohort.band === band)
      expect(forBand.map((c) => c.variant.name).sort()).toEqual([
        'none',
        'single-multivalue',
      ])
    }
  })

  it('emits csv for every cohort except mega and statewide', () => {
    const csv = cases.filter((c) => c.queryType === 'csv')
    expect(csv.length).toBe(3)
    expect(csv.some((c) => c.cohort.band === 'statewide')).toBe(false)
    expect(csv.some((c) => c.cohort.band === 'mega')).toBe(false)
    expect(csv.every((c) => c.variant.name === 'none')).toBe(true)
  })

  it('runs stats once per cohort with the none variant only', () => {
    const stats = cases.filter((c) => c.queryType === 'stats')
    expect(stats.length).toBe(5)
    expect(stats.every((c) => c.variant.name === 'none')).toBe(true)
  })

  it('runs voterDensity once per cohort with the none variant only', () => {
    const density = cases.filter((c) => c.queryType === 'voterDensity')
    expect(density.length).toBe(5)
    expect(density.every((c) => c.variant.name === 'none')).toBe(true)
  })

  it('covers the list-detail aggregate fan-out on the join-path mega cohort', () => {
    // The production 504 is getAggregates ('count') on a large non-statewide
    // district: the base tile plus the three channel-restricted tiles.
    const megaCount = cases.filter(
      (c) => c.cohort.band === 'mega' && c.queryType === 'count',
    )
    const variants = megaCount.map((c) => c.variant.name)
    expect(variants).toContain('none')
    expect(variants).toContain('single-boolean')
    expect(variants).toContain('channel-landline')
    expect(variants).toContain('channel-address')
  })

  it('down-samples the large count cells — they run near the 25s timeout', () => {
    const largeCount = cases.filter(
      (c) => c.cohort.band === 'large' && c.queryType === 'count',
    )
    expect(largeCount.length).toBeGreaterThan(0)
    expect(
      largeCount.every(
        (c) => c.iterations < DEFAULT_ITERATIONS && c.iterations >= 3,
      ),
    ).toBe(true)
  })

  it('keeps full iterations on mega — bigger district, but a fast partition', () => {
    const megaCount = cases.filter(
      (c) => c.cohort.band === 'mega' && c.queryType === 'count',
    )
    expect(megaCount.length).toBeGreaterThan(0)
    expect(megaCount.every((c) => c.iterations === DEFAULT_ITERATIONS)).toBe(
      true,
    )
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
