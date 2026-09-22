import { describe, expect, it } from 'vitest'
import {
  compareLegs,
  compareLegsDetailed,
  LegOutcome,
} from './voterDensityComparison'

type Cell = { lat: number; lng: number; count: number }

const ok = (cells: Cell[], coverage: number | null = null): LegOutcome => ({
  ok: true,
  value: { coverage, cells },
})

/** The "person maps to no district" answer both legs give as null. */
const noDistrict = (): LegOutcome => ({ ok: true, value: null })

const failed = (): LegOutcome => ({ ok: false, error: new Error('boom') })

const CELLS: Cell[] = [
  { lat: 34.1, lng: -118.2, count: 12 },
  { lat: 34.2, lng: -118.1, count: 7 },
]

describe('compareLegs', () => {
  it('matches identical cells and coverage', () => {
    expect(compareLegs(ok(CELLS, 0.82), ok(CELLS, 0.82))).toBe('match')
  })

  it('matches when neither side resolves a district', () => {
    expect(compareLegs(noDistrict(), noDistrict())).toBe('match')
  })

  it('matches an empty district against a null one', () => {
    // "resolved to a district with no published cells" and "resolved to no
    // district" are the same no-map outcome to the page, and the two legs
    // arrive at it by different routes; treating that as a divergence would
    // bury the real ones.
    expect(compareLegs(ok([]), noDistrict())).toBe('match')
  })

  it('reports only_legacy when election-db has not been loaded yet', () => {
    expect(compareLegs(ok(CELLS, 0.82), ok([]))).toBe('only_legacy')
  })

  it('reports only_legacy rather than a mismatch even when coverage differs', () => {
    // The distinction that gates the cutover: an unloaded district must not be
    // counted as a defect, or the mismatch signal is unreadable until the very
    // end of the migration.
    expect(compareLegs(ok(CELLS, 0.82), ok([], 0.1))).toBe('only_legacy')
  })

  it('reports only_new when people-db is the one missing cells', () => {
    expect(compareLegs(ok([]), ok(CELLS, 0.82))).toBe('only_new')
  })

  it('reports only_new against a null legacy district', () => {
    expect(compareLegs(noDistrict(), ok(CELLS))).toBe('only_new')
  })

  it('reports a cell mismatch when the counts differ', () => {
    const changed = [CELLS[0]!, { ...CELLS[1]!, count: 8 }]
    expect(compareLegs(ok(CELLS), ok(changed))).toBe('cell_mismatch')
  })

  it('reports a cell mismatch when one side has an extra cell', () => {
    const extra = [...CELLS, { lat: 34.3, lng: -118.0, count: 5 }]
    expect(compareLegs(ok(CELLS), ok(extra))).toBe('cell_mismatch')
  })

  it('reports a cell mismatch when the two are ordered differently', () => {
    // gp-marketing renders the array in the order given, so an ordering
    // difference is a rendering difference.
    expect(compareLegs(ok(CELLS), ok([...CELLS].reverse()))).toBe(
      'cell_mismatch',
    )
  })

  it('reports a cell mismatch on a genuinely different centroid', () => {
    const moved = [{ ...CELLS[0]!, lat: 34.10001 }, CELLS[1]!]
    expect(compareLegs(ok(CELLS), ok(moved))).toBe('cell_mismatch')
  })

  it('tolerates float noise below the epsilon', () => {
    // The same centroid arriving via Prisma's double and via a JSON round-trip
    // must not read as a moved cell.
    const jittered = [{ ...CELLS[0]!, lat: 34.1 + 1e-12 }, CELLS[1]!]
    expect(compareLegs(ok(CELLS), ok(jittered))).toBe('match')
  })

  it('reports a coverage mismatch when only the coverage differs', () => {
    expect(compareLegs(ok(CELLS, 0.82), ok(CELLS, 0.5))).toBe(
      'coverage_mismatch',
    )
  })

  it('treats zero coverage as different from absent coverage', () => {
    // A fully suppressed district and one the pipeline never built are
    // different states; collapsing them would hide a build that produced
    // nothing.
    expect(compareLegs(ok(CELLS, 0), ok(CELLS, null))).toBe('coverage_mismatch')
  })

  it('reports error when the shadow leg failed', () => {
    expect(compareLegs(ok(CELLS, 0.82), failed())).toBe('error')
  })

  it('reports error when the legacy leg failed', () => {
    expect(compareLegs(failed(), ok(CELLS, 0.82))).toBe('error')
  })

  it('reports error rather than match when both legs failed', () => {
    // Two outages agreeing is not agreement.
    expect(compareLegs(failed(), failed())).toBe('error')
  })
})

/**
 * A district on the scale the tolerances were measured against: cells at
 * ascending (lat, lng), which is the order both sources publish in.
 */
const district = (counts: number[]): Cell[] =>
  counts.map((count, i) => ({
    lat: 34 + i * 1e-3,
    lng: -118 + i * 1e-3,
    count,
  }))

/** K-anonymity floor in the mart: `voter_density_k` is 10. */
const K = 10

/** 500 ordinary cells and one sitting exactly on the suppression boundary. */
const TYPICAL = district([...Array(500).fill(100), K])

/** The boundary cell dropping out, which is what a fresher vintage does. */
const WITHOUT_BOUNDARY_CELL = district(Array(500).fill(100))

describe('tolerating vintage skew', () => {
  // The two legs are copies of one dbt mart on different refresh schedules —
  // people-db monthly, election-db nightly — so they are almost never built
  // from the same vintage. Before this, exact equality called ~70% of
  // production traffic a mismatch, which made "flip when the comparison reads
  // clean" unreachable. These are the cases that distinguish that skew from a
  // defect; the numbers come from 30 days of production sampling, recorded in
  // voterDensityComparison.ts.

  it('tolerates a suppressed cell dropping between vintages', () => {
    // One 10-voter cell out of ~50k is 0.02% of the surface. This is the
    // single most common real divergence and it is invisible on a heat map.
    expect(compareLegs(ok(TYPICAL), ok(WITHOUT_BOUNDARY_CELL))).toBe(
      'match_within_tolerance',
    )
  })

  it('tolerates it appearing rather than dropping', () => {
    // Direction carries no information here: which leg is fresher depends on
    // where in the month the request lands.
    expect(compareLegs(ok(WITHOUT_BOUNDARY_CELL), ok(TYPICAL))).toBe(
      'match_within_tolerance',
    )
  })

  it('does not let a dropped cell misreport the cells after it', () => {
    // The actual bug. The old comparison walked the two arrays by index, so
    // one cell removed from the front shifted every later cell against a
    // different neighbour and reported the entire district as changed. Dropping
    // the FIRST cell is the case that pins it: by position nothing else moved.
    const [, ...tail] = TYPICAL
    const { result, driftedVoters } = compareLegsDetailed(ok(TYPICAL), ok(tail))

    // Exactly the one dropped cell's voters, not the 500 cells behind it.
    expect(driftedVoters).toBe(100)
    expect(result).toBe('match_within_tolerance')
  })

  it('still reports an exact agreement as an exact match', () => {
    // The tolerance must not swallow the signal it exists to expose: once the
    // schedules align, this is what should be climbing.
    expect(compareLegs(ok(TYPICAL, 0.82), ok(TYPICAL, 0.82))).toBe('match')
  })

  it('tolerates coverage drifting in the sixth decimal place', () => {
    // 73% of reported mismatches were only this: `coverage` counts
    // non-geocoded voters in its denominator, so one voter moving house
    // changes it without touching a cell.
    expect(compareLegs(ok(TYPICAL, 0.8241), ok(TYPICAL, 0.8239))).toBe(
      'match_within_tolerance',
    )
  })
})

describe('catching real divergence', () => {
  it('reports a heavy cell vanishing even though it fits the budget', () => {
    // Why the per-cell cap exists. This cell is 0.69% of the district: inside
    // the 1% aggregate budget, so the budget alone would wave it through, but
    // a cell carrying that much weight is a visible hole in the surface. Many
    // tiny cells flickering and one heavy cell disappearing must not be the
    // same event.
    const heavy = district([...Array(999).fill(100), 700])
    const { result, driftFraction, largestCellDriftFraction } =
      compareLegsDetailed(ok(heavy), ok(district(Array(999).fill(100))))

    expect(driftFraction).toBeLessThan(0.01)
    expect(largestCellDriftFraction).toBeGreaterThan(0.005)
    expect(result).toBe('cell_mismatch')
  })

  it('reports enough small cells to add up past the budget', () => {
    const full = district([...Array(200).fill(50), ...Array(30).fill(K)])
    const { result, driftFraction } = compareLegsDetailed(
      ok(full),
      ok(district(Array(200).fill(50))),
    )

    expect(driftFraction).toBeGreaterThan(0.01)
    expect(result).toBe('cell_mismatch')
  })

  it('reports a district that moved wholesale', () => {
    // The shape an id-derivation mistake takes: plausible cells, wrong place.
    const elsewhere = TYPICAL.map((cell) => ({ ...cell, lat: cell.lat + 1 }))
    expect(compareLegs(ok(TYPICAL), ok(elsewhere))).toBe('cell_mismatch')
  })

  it('reports coverage disagreeing about whether a map should render', () => {
    expect(compareLegs(ok(TYPICAL, 0.82), ok(TYPICAL, 0.41))).toBe(
      'coverage_mismatch',
    )
  })

  it('counts two rows on one centroid rather than letting one win', () => {
    // Deduplicating by position could hide a duplicated row, which is a real
    // pipeline defect, so the voters on a repeated centroid are summed.
    const doubled = [...TYPICAL, { ...TYPICAL[0]!, count: 4000 }]
    const { result, driftedVoters } = compareLegsDetailed(
      ok(TYPICAL),
      ok(doubled),
    )
    expect(driftedVoters).toBe(4000)
    expect(result).toBe('cell_mismatch')
  })

  it('measures drift against the larger side', () => {
    // Dividing by the side that lost cells would inflate the fraction exactly
    // when cells go missing, which is when the number has to be trustworthy.
    const { driftFraction } = compareLegsDetailed(
      ok(TYPICAL),
      ok(WITHOUT_BOUNDARY_CELL),
    )
    expect(driftFraction).toBeCloseTo(K / (500 * 100 + K), 12)
  })
})
