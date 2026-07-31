import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Harness } from './harness'
import { buildLatencyCases } from './cases'
import { summarize } from './stats'
import { COHORTS, checkDrift } from './cohorts'
import {
  artifactPath,
  buildArtifact,
  formatTable,
  type CaseResult,
} from './report'

export const runLatency = async (
  harness: Harness,
  opts: { env: string; gitSha: string },
): Promise<CaseResult[]> => {
  // Drift guard: warn (do not fail) if a pinned district has left its band.
  for (const cohort of COHORTS) {
    try {
      const actual = await harness.totalConstituents(cohort.districtId)
      const drift = checkDrift(cohort, actual)
      if (!drift.ok) console.warn(`WARN ${drift.message}`)
    } catch (err) {
      console.warn(`drift check failed for ${cohort.band}: ${err}`)
    }
  }

  const cases = buildLatencyCases()
  const results: CaseResult[] = []

  for (const c of cases) {
    const durations: number[] = []
    let failures = 0
    let cold = 0
    for (let i = 0; i < c.iterations; i += 1) {
      const t = performance.now()
      try {
        await harness.invoke(c)
        const elapsed = performance.now() - t
        if (i === 0) cold = elapsed
        else durations.push(elapsed)
      } catch {
        failures += 1
      }
    }
    // When iterations === 1 there is no warm sample; fall back to the cold hit.
    const warm = summarize(
      durations.length > 0 ? durations : cold ? [cold] : [],
    )
    results.push({
      id: c.id,
      queryType: c.queryType,
      band: c.cohort.band,
      variant: c.variant.name,
      iterations: c.iterations,
      failures,
      cold,
      warm,
    })
    console.log(
      `done ${c.id} (cold ${Math.round(cold)}ms, warm p95 ${Math.round(warm.p95)}ms)`,
    )
  }

  console.log('\n' + formatTable(results))

  const path = artifactPath({
    env: opts.env,
    mode: 'latency',
    gitSha: opts.gitSha,
  })
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    JSON.stringify(
      buildArtifact(
        {
          env: opts.env,
          mode: 'latency',
          gitSha: opts.gitSha,
          startedAt: new Date().toISOString(),
        },
        results,
      ),
      null,
      2,
    ),
  )
  console.log(`\nartifact: ${path}`)
  return results
}
