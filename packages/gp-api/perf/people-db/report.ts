import type { Summary } from './stats'

export type CaseResult = {
  id: string
  queryType: string
  band: string
  variant: string
  iterations: number
  failures: number
  errors: string[]
  cold: number
  warm: Summary
}

export const artifactPath = (meta: {
  env: string
  mode: string
  gitSha: string
}): string =>
  `scripts/output/people-db-bench-${meta.env}-${meta.gitSha}-${meta.mode}.json`

export const buildArtifact = (
  meta: { env: string; mode: string; gitSha: string; startedAt: string },
  results: unknown[],
): object => ({ ...meta, results })

const ms = (n: number): string => `${Math.round(n)}ms`

export const formatTable = (results: CaseResult[]): string => {
  const header = ['case', 'iters', 'cold', 'warm p50', 'warm p95', 'err'].join(
    '  |  ',
  )
  const rows = results.map((r) =>
    [
      r.id.padEnd(34),
      String(r.iterations),
      ms(r.cold),
      ms(r.warm.p50),
      ms(r.warm.p95),
      r.failures > 0 ? `${r.failures}/${r.iterations}` : '0',
    ].join('  |  '),
  )
  return [header, ...rows].join('\n')
}
