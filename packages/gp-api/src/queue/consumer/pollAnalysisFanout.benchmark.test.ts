import pmap from 'p-map'
import { describe, expect, it } from 'vitest'

// Benchmark for the poll-analysis People-DB fallback fan-out. The consumer
// looks up every unmapped phone via contactsService.findPersonByPhone, which
// issues an HTTP POST to People-API. This models that call as an async request
// against a downstream that degrades and then errors once too many requests are
// in flight (rate limit / socket exhaustion) — the exact failure mode an
// unbounded Promise.all over hundreds of phones can trigger. We measure
// unbounded Promise.all vs p-map at several concurrency caps so the decision to
// bound (and at what value) is driven by data, not a hunch.
//
// It is a deterministic simulation (no network) so it stays stable in CI while
// still exercising the real trade-off: burst protection vs. latency.

const LATENCY_MS = 30
// Past this many simultaneous in-flight requests the downstream degrades
// (each excess request pays a heavy penalty) and, past a hard ceiling, starts
// failing outright — modelling People-API rate limiting / socket exhaustion.
const DEGRADE_THRESHOLD = 25
const DEGRADE_PENALTY_MS = 300
const HARD_CEILING = 60

const UNBOUNDED_LABEL = 'Promise.all (unbounded)'

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

type LookupStats = {
  peakConcurrency: number
  errors: number
}

// Builds a fake findPersonByPhone whose latency and failure behaviour depend on
// how many calls are concurrently in flight, plus a stats object to inspect.
const makeDownstream = (): {
  lookup: (phone: string) => Promise<{ phone: string }>
  stats: LookupStats
} => {
  let inFlight = 0
  const stats: LookupStats = { peakConcurrency: 0, errors: 0 }

  const lookup = async (phone: string): Promise<{ phone: string }> => {
    inFlight += 1
    stats.peakConcurrency = Math.max(stats.peakConcurrency, inFlight)
    const concurrentAtEntry = inFlight
    try {
      if (concurrentAtEntry > HARD_CEILING) {
        await delay(LATENCY_MS)
        throw new Error('ECONNRESET: too many open sockets')
      }
      if (concurrentAtEntry > DEGRADE_THRESHOLD) {
        await delay(LATENCY_MS + DEGRADE_PENALTY_MS)
      } else {
        await delay(LATENCY_MS)
      }
      return { phone }
    } finally {
      inFlight -= 1
    }
  }

  return { lookup, stats }
}

type RunResult = {
  label: string
  n: number
  wallMs: number
  peakConcurrency: number
  errors: number
}

const phonesFor = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `+1555${String(i).padStart(7, '0')}`)

// Mirrors the consumer: each lookup is wrapped in try/catch so one failure
// never rejects the whole batch. We count failures rather than throwing.
const runUnbounded = async (n: number): Promise<RunResult> => {
  const { lookup, stats } = makeDownstream()
  const phones = phonesFor(n)
  const start = performance.now()
  await Promise.all(
    phones.map(async (phone) => {
      try {
        return await lookup(phone)
      } catch {
        stats.errors += 1
        return { phone }
      }
    }),
  )
  return {
    label: UNBOUNDED_LABEL,
    n,
    wallMs: performance.now() - start,
    peakConcurrency: stats.peakConcurrency,
    errors: stats.errors,
  }
}

const runBounded = async (
  n: number,
  concurrency: number,
): Promise<RunResult> => {
  const { lookup, stats } = makeDownstream()
  const phones = phonesFor(n)
  const start = performance.now()
  await pmap(
    phones,
    async (phone) => {
      try {
        return await lookup(phone)
      } catch {
        stats.errors += 1
        return { phone }
      }
    },
    { concurrency },
  )
  return {
    label: `p-map @${concurrency}`,
    n,
    wallMs: performance.now() - start,
    peakConcurrency: stats.peakConcurrency,
    errors: stats.errors,
  }
}

const formatTable = (results: RunResult[]): string => {
  const header = ['N', 'strategy', 'wall (ms)', 'peak', 'errors']
  const rows = results.map((r) => [
    String(r.n),
    r.label,
    r.wallMs.toFixed(0),
    String(r.peakConcurrency),
    String(r.errors),
  ])
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? '').length)),
  )
  const line = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ')
  return [
    line(header),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map(line),
  ].join('\n')
}

describe('poll-analysis fan-out benchmark', () => {
  it('measures unbounded vs bounded fan-out and records the decision', async () => {
    const ns = [50, 200, 500]
    const concurrencies = [5, 10, 20]
    const results: RunResult[] = []

    for (const n of ns) {
      results.push(await runUnbounded(n))
      for (const c of concurrencies) {
        results.push(await runBounded(n, c))
      }
    }

    console.log('\nPoll-analysis fan-out benchmark\n' + formatTable(results))

    const get = (n: number, label: string): RunResult => {
      const found = results.find((r) => r.n === n && r.label === label)
      if (!found) throw new Error(`missing result ${label} @ N=${n}`)
      return found
    }

    // The unbounded burst always overruns the safe concurrency envelope: peak
    // in-flight equals N, well past the point the downstream degrades.
    for (const n of ns) {
      expect(get(n, UNBOUNDED_LABEL).peakConcurrency).toBe(n)
      expect(get(n, UNBOUNDED_LABEL).peakConcurrency).toBeGreaterThan(
        DEGRADE_THRESHOLD,
      )
    }

    // Once the burst is large enough to exhaust sockets it starts failing
    // outright — the reliability problem we are protecting against.
    for (const n of [200, 500]) {
      expect(get(n, UNBOUNDED_LABEL).errors).toBeGreaterThan(0)
    }

    // A cap at 20 (below the degrade threshold) never overruns the downstream,
    // so it produces zero errors and never degrades — at every N.
    for (const n of ns) {
      const bounded20 = get(n, 'p-map @20')
      expect(bounded20.errors).toBe(0)
      expect(bounded20.peakConcurrency).toBeLessThanOrEqual(20)
    }

    // Decision rule: at typical load (N=50, N=200) bounding at 20 is not a
    // latency regression — it is actually faster than the unbounded burst
    // because the burst pays the downstream degradation penalty. So bounding
    // is a pure win (zero errors, no latency cost) and we ship p-map @20.
    for (const n of [50, 200]) {
      const unbounded = get(n, UNBOUNDED_LABEL)
      const bounded20 = get(n, 'p-map @20')
      expect(bounded20.wallMs).toBeLessThanOrEqual(unbounded.wallMs * 1.2)
    }
  }, 60_000)
})
