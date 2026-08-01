import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Harness } from './harness'
import { LOAD_SCENARIOS, scenarioCase } from './loadScenarios'
import { summarize, errorRate } from './stats'
import { artifactPath, buildArtifact } from './report'
import { COHORTS } from './cohorts'

type LevelResult = {
  concurrency: number
  p50: number
  p95: number
  max: number
  errorRate: number
  throughputPerSec: number
  errors: string[]
}

type ScenarioResult = { id: string; levels: LevelResult[]; passed: boolean }

export const runLoad = async (
  harness: Harness,
  opts: { env: string; gitSha: string },
): Promise<{ ok: boolean }> => {
  const scenarios: ScenarioResult[] = []
  let ok = true

  const bands = new Set(LOAD_SCENARIOS.map((s) => s.band))
  for (const band of bands) {
    const cohort = COHORTS.find((c) => c.band === band)
    if (!cohort) continue
    try {
      const actual = await harness.totalConstituents(cohort.districtId)
      if (actual === 0) {
        console.warn(
          `WARN ${band}: 0 constituents — load result may be meaningless`,
        )
      }
    } catch (err) {
      console.warn(`liveness check failed for ${band}: ${err}`)
    }
  }

  for (const s of LOAD_SCENARIOS) {
    const bench = scenarioCase(s)
    const levels: LevelResult[] = []
    let passed = true

    for (const concurrency of s.concurrencyLevels) {
      const start = performance.now()
      const outcomes = await Promise.all(
        Array.from({ length: concurrency }, async () => {
          const t = performance.now()
          try {
            await harness.invoke(bench)
            return { ms: performance.now() - t, failed: false, error: '' }
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err)
            return { ms: performance.now() - t, failed: true, error }
          }
        }),
      )
      const wallSec = (performance.now() - start) / 1000
      const durations = outcomes.filter((o) => !o.failed).map((o) => o.ms)
      const failures = outcomes.filter((o) => o.failed).length
      const errors = [
        ...new Set(outcomes.filter((o) => o.failed).map((o) => o.error)),
      ]
      const summary = summarize(durations)
      const rate = errorRate(outcomes.length, failures)
      levels.push({
        concurrency,
        p50: summary.p50,
        p95: summary.p95,
        max: summary.max,
        errorRate: rate,
        throughputPerSec: wallSec > 0 ? concurrency / wallSec : 0,
        errors,
      })
      if (concurrency === s.targetConcurrency && rate > s.maxErrorRate) {
        passed = false
      }
    }

    console.log(`\n${s.id}`)
    for (const l of levels) {
      console.log(
        `  c=${String(l.concurrency).padStart(3)}  p50=${Math.round(l.p50)}ms  p95=${Math.round(l.p95)}ms  err=${(l.errorRate * 100).toFixed(0)}%  tput=${l.throughputPerSec.toFixed(1)}/s`,
      )
      for (const msg of l.errors) console.log(`       error: ${msg}`)
    }
    console.log(
      `  -> ${passed ? 'PASS' : 'FAIL'} at target concurrency ${s.targetConcurrency}`,
    )
    if (!passed) ok = false
    scenarios.push({ id: s.id, levels, passed })
  }

  const path = artifactPath({
    env: opts.env,
    mode: 'load',
    gitSha: opts.gitSha,
  })
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    JSON.stringify(
      buildArtifact(
        {
          env: opts.env,
          mode: 'load',
          gitSha: opts.gitSha,
          startedAt: new Date().toISOString(),
        },
        scenarios,
      ),
      null,
      2,
    ),
  )
  console.log(`\nartifact: ${path}\noverall: ${ok ? 'PASS' : 'FAIL'}`)
  return { ok }
}
