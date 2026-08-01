import { describe, it, expect } from 'vitest'
import {
  buildArtifact,
  artifactPath,
  formatTable,
  type CaseResult,
} from './report'

const result: CaseResult = {
  id: 'count:small:none',
  queryType: 'count',
  band: 'small',
  variant: 'none',
  iterations: 5,
  failures: 0,
  errors: [],
  cold: 120,
  warm: { count: 4, min: 30, max: 45, mean: 38, p50: 38, p95: 45 },
}

describe('report', () => {
  it('builds a diff-able artifact object', () => {
    const a = buildArtifact(
      {
        env: 'dev',
        mode: 'latency',
        gitSha: 'abc123',
        startedAt: '2026-07-31T00:00:00Z',
      },
      [result],
    ) as { env: string; results: unknown[] }
    expect(a.env).toBe('dev')
    expect(a.results).toHaveLength(1)
  })

  it('derives the artifact path', () => {
    expect(
      artifactPath({ env: 'prod', mode: 'load', gitSha: 'deadbeef' }),
    ).toBe('scripts/output/people-db-bench-prod-deadbeef-load.json')
  })

  it('formats a table containing the case id and p95', () => {
    const table = formatTable([result])
    expect(table).toContain('count:small:none')
    expect(table).toContain('45')
  })
})
