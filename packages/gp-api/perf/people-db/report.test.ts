import { describe, it, expect } from 'vitest'
import {
  buildArtifact,
  artifactPath,
  buildLegend,
  formatMatrix,
  type CaseResult,
} from './report'

const mk = (over: Partial<CaseResult>): CaseResult => ({
  id: 'count:small:none',
  queryType: 'count',
  band: 'small',
  variant: 'none',
  iterations: 8,
  failures: 0,
  errors: [],
  cold: 120,
  warm: { count: 7, min: 30, max: 45, mean: 38, p50: 38, p95: 45 },
  ...over,
})

describe('report', () => {
  it('builds a diff-able artifact object', () => {
    const a = buildArtifact(
      {
        env: 'dev',
        mode: 'latency',
        gitSha: 'abc123',
        startedAt: '2026-07-31T00:00:00Z',
      },
      [mk({})],
    ) as { env: string; results: unknown[] }
    expect(a.env).toBe('dev')
    expect(a.results).toHaveLength(1)
  })

  it('derives the artifact path', () => {
    expect(
      artifactPath({ env: 'prod', mode: 'load', gitSha: 'deadbeef' }),
    ).toBe('scripts/output/people-db-bench-prod-deadbeef-load.json')
  })

  it('legend defines the jargon a first-time reader needs', () => {
    const legend = buildLegend()
    for (const term of [
      'selectivity',
      'multivalue',
      'narrow-highselectivity',
      'median/max',
      'cold',
    ]) {
      expect(legend).toContain(term)
    }
  })

  it('matrix places a case at its query/cohort with median/max', () => {
    const matrix = formatMatrix([
      mk({ band: 'small', warm: { ...mk({}).warm, p50: 38, max: 45 } }),
      mk({ band: 'large', warm: { ...mk({}).warm, p50: 1500, max: 1600 } }),
    ])
    expect(matrix).toContain('count none')
    expect(matrix).toContain('small')
    expect(matrix).toContain('large')
    expect(matrix).toContain('38/45')
    expect(matrix).toContain('1500/1600')
  })

  it('leads each cell with the cold time, not just the warm summary', () => {
    // Cold is the production failure shape (fresh cluster, empty buffer pool),
    // so it must be visible in the printed matrix — not only in the artifact.
    const matrix = formatMatrix([mk({ cold: 24980 })])
    expect(matrix).toContain('24980|38/45')
    expect(matrix).toContain('cold')
  })

  it('shows ERR for a cold run that failed while warm runs passed', () => {
    // The exact large-district case: cold blows the 25s statement timeout,
    // warm runs come back. Reporting only the warm number would hide it.
    const matrix = formatMatrix([mk({ cold: null, failures: 1 })])
    expect(matrix).toContain('ERR|38/45!1')
  })

  it('matrix appends * when a cell has fewer than 4 warm samples', () => {
    const base = mk({}).warm
    const marked = formatMatrix([
      mk({ band: 'small', warm: { ...base, count: 2, p50: 38, max: 45 } }),
    ])
    expect(marked).toContain('38/45*')
    const unmarked = formatMatrix([
      mk({ band: 'small', warm: { ...base, count: 4, p50: 38, max: 45 } }),
    ])
    expect(unmarked).not.toContain('*')
  })

  it('matrix marks all-failed cells FAIL and missing cells with a dash', () => {
    // two bands present, but each row only has one — the other cell is a gap
    const matrix = formatMatrix([
      mk({ queryType: 'overlap', band: 'small', failures: 8, iterations: 8 }),
      mk({ queryType: 'count', band: 'large' }),
    ])
    expect(matrix).toContain('FAIL(8/8)')
    expect(matrix).toContain('—')
  })
})
