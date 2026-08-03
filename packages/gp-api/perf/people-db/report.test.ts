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
      'p50/p95',
      'cold',
    ]) {
      expect(legend).toContain(term)
    }
  })

  it('matrix places a case at its query/cohort with warm p50/p95', () => {
    const matrix = formatMatrix([
      mk({ band: 'small', warm: { ...mk({}).warm, p50: 38, p95: 45 } }),
      mk({ band: 'large', warm: { ...mk({}).warm, p50: 1500, p95: 1600 } }),
    ])
    expect(matrix).toContain('count none')
    expect(matrix).toContain('small')
    expect(matrix).toContain('large')
    expect(matrix).toContain('38/45')
    expect(matrix).toContain('1500/1600')
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
