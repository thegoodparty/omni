import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Harness } from './harness'
import { buildLatencyCases } from './cases'
import { summarize } from './stats'
import { COHORTS, checkDrift } from './cohorts'
import { writeArtifactHtml } from './writeArtifactHtml'
import {
  artifactPath,
  buildArtifact,
  buildLegend,
  formatMatrix,
  type CaseResult,
} from './report'

export const runLatency = async (
  harness: Harness,
  opts: { env: string; store: string; gitSha: string },
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
  // Materialize the outreach id sets BEFORE the timed loop. Sampling is setup,
  // not measurement, and folding it into the first outreach cell of each band
  // inflated that one cell by ~50s.
  await harness.prepare(cases)
  const results: CaseResult[] = []

  for (const c of cases) {
    const durations: number[] = []
    const errors: string[] = []
    // null (not 0) is the unset sentinel: performance.now() deltas are always
    // positive, so a failed cold iteration must not masquerade as a fast 0ms.
    let cold: number | null = null
    for (let i = 0; i < c.iterations; i += 1) {
      const t = performance.now()
      try {
        await harness.invoke(c)
        const elapsed = performance.now() - t
        if (i === 0) cold = elapsed
        else durations.push(elapsed)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }
    // When iterations === 1 there is no warm sample; fall back to the cold
    // hit. With iterations > 1 and every warm run failed, keep the all-zeros
    // sentinel so warm stats are never silently derived from the cold hit.
    const warmSamples =
      durations.length > 0
        ? durations
        : c.iterations === 1 && cold !== null
          ? [cold]
          : []
    const warm = summarize(warmSamples)
    results.push({
      id: c.id,
      queryType: c.queryType,
      band: c.cohort.band,
      variant: c.variant.name,
      iterations: c.iterations,
      failures: errors.length,
      errors,
      cold,
      warm,
    })
    const coldLabel = cold !== null ? `${Math.round(cold)}ms` : 'ERR'
    console.log(
      `done ${c.id} (cold ${coldLabel}, warm p95 ${Math.round(warm.p95)}ms)`,
    )
  }

  console.log('\n' + buildLegend())
  console.log('\n' + formatMatrix(results))

  const failed = results.filter((r) => r.failures > 0)
  if (failed.length > 0) {
    console.log('\nfailures:')
    for (const r of failed) {
      for (const msg of [...new Set(r.errors)]) {
        console.log(`  ${r.id}: ${msg}`)
      }
    }
  }

  const path = artifactPath({
    env: opts.env,
    mode: 'latency',
    store: opts.store,
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
          store: opts.store,
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
  // Emitted on every run, not on request: a pass that only leaves JSON behind
  // is a pass nobody reads.
  const htmlPath = writeArtifactHtml(path)
  console.log(`artifact (html): ${htmlPath}`)
  return results
}
