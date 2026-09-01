import { describe, expect, it } from 'vitest'
import { compareLegs, LegOutcome } from './voterDensityComparison'

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
