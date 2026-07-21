import { chunk } from 'es-toolkit'
import pMap from 'p-map'
import { describe, expect, it } from 'vitest'

// Wall-clock benchmark + correctness harness for the daily-briefing cron's two
// perf wins:
//   1. a DB-side pre-filter that stops the loop from touching offices that can
//      never dispatch, and
//   2. bounded concurrency (via the same p-map used in production) replacing
//      the previously fully-serial per-office loop.
//
// It models the cron's structure in-memory so it stays fast and deterministic:
// each office carries the boolean gates the real dispatchBriefingIfNeeded
// checks plus a per-office latency, and the two loop shapes below mirror the
// before/after cron exactly (including the intentional inter-batch throttle).

type BenchOffice = {
  id: string
  // Gate mirrors of dispatchBriefingIfNeeded (see meetingBriefings.service.ts):
  hasScheduleRun: boolean // COMPLETED meeting_schedule run w/ artifact pointers
  hasFutureBriefing: boolean // MeetingBriefing already covering meetingDate >= now
  hasInFlightRun: boolean // QUEUED/RUNNING/AWAITING_RESUME briefing run
  inImminenceWindow: boolean // schedule projects a meeting inside the 3-day window
  isServeIcp: boolean // serve-ICP position (from election-api)
  isActive: boolean // user active within the inactivity threshold
  latencyMs: number // simulated per-office async work (DB + S3 + election-api)
}

// The full dispatch decision the per-office guard makes. Kept as the single
// source of truth both loop shapes route through, so any outcome difference
// between them is purely a function of ordering/filtering, not the predicate.
const officeWouldDispatch = (o: BenchOffice): boolean =>
  o.hasScheduleRun &&
  !o.hasFutureBriefing &&
  !o.hasInFlightRun &&
  o.inImminenceWindow &&
  o.isServeIcp &&
  o.isActive

// The DB-side pre-filter applied in the cron's findMany `where`. These are the
// only two dispatch preconditions expressible in gp-api SQL (schedule presence
// + coverage dedupe); everything else stays in the per-office guard.
const passesPrefilter = (o: BenchOffice): boolean =>
  o.hasScheduleRun && !o.hasFutureBriefing

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs))

const makeProcessor =
  (dispatched: Set<string>) =>
  async (o: BenchOffice): Promise<void> => {
    // Simulate the real per-office async work (findFirst + schedule S3 read +
    // election-api serve-context + dispatch enqueue).
    await sleep(o.latencyMs)
    if (officeWouldDispatch(o)) dispatched.add(o.id)
  }

// BEFORE: the old cron — process every office, strictly serially within a
// batch, with an inter-batch throttle between batches.
const runSerial = async (
  offices: BenchOffice[],
  opts: { batchSize: number; interBatchMs: number },
  process: (o: BenchOffice) => Promise<void>,
): Promise<void> => {
  const chunks = chunk(offices, opts.batchSize)
  for (const [i, batch] of chunks.entries()) {
    for (const o of batch) {
      await process(o)
    }
    if (i < chunks.length - 1) await sleep(opts.interBatchMs)
  }
}

// AFTER: bounded concurrency WITHIN a batch (same p-map primitive as prod),
// preserving the identical inter-batch throttle.
const runBoundedConcurrent = async (
  offices: BenchOffice[],
  opts: { batchSize: number; interBatchMs: number; concurrency: number },
  process: (o: BenchOffice) => Promise<void>,
): Promise<void> => {
  const chunks = chunk(offices, opts.batchSize)
  for (const [i, batch] of chunks.entries()) {
    await pMap(batch, process, { concurrency: opts.concurrency })
    if (i < chunks.length - 1) await sleep(opts.interBatchMs)
  }
}

// Deterministic population: the realistic case is that most offices have no
// completed schedule yet (serve-ICP backfill still pending), so the pre-filter
// eliminates the majority before any per-office work runs.
const buildOffices = (): BenchOffice[] => {
  const base: Omit<BenchOffice, 'id' | 'latencyMs'> = {
    hasScheduleRun: true,
    hasFutureBriefing: false,
    hasInFlightRun: false,
    inImminenceWindow: true,
    isServeIcp: true,
    isActive: true,
  }
  const specs: Array<{
    count: number
    template: Omit<BenchOffice, 'id' | 'latencyMs'>
  }> = [
    // Excluded by the pre-filter (no schedule run yet) — the common case.
    { count: 27, template: { ...base, hasScheduleRun: false } },
    // Excluded by the pre-filter (already covered by a future briefing).
    { count: 3, template: { ...base, hasFutureBriefing: true } },
    // Survive the pre-filter but the per-office guard still skips them:
    { count: 3, template: { ...base, inImminenceWindow: false } },
    { count: 3, template: { ...base, isServeIcp: false } },
    { count: 3, template: { ...base, isActive: false } },
    { count: 3, template: { ...base, hasInFlightRun: true } },
    // Fully qualify — these actually dispatch.
    { count: 3, template: { ...base } },
  ]

  const offices: BenchOffice[] = []
  let idx = 0
  for (const { count, template } of specs) {
    for (let n = 0; n < count; n++) {
      offices.push({
        id: `office-${idx}`,
        latencyMs: 20 + (idx % 3) * 10, // 20 / 30 / 40 ms
        ...template,
      })
      idx++
    }
  }
  return offices
}

const LOOP_OPTS = { batchSize: 15, interBatchMs: 20, concurrency: 10 }

describe('dispatchDailyBriefings perf: pre-filter + bounded concurrency', () => {
  it('bounded concurrency + pre-filter is dramatically faster than the serial loop', async () => {
    const offices = buildOffices()
    const candidates = offices.filter(passesPrefilter)

    // BEFORE: serial over the entire population.
    const beforeDispatched = new Set<string>()
    const beforeStart = performance.now()
    await runSerial(offices, LOOP_OPTS, makeProcessor(beforeDispatched))
    const beforeMs = performance.now() - beforeStart

    // AFTER: bounded concurrency over only the pre-filtered candidates.
    const afterDispatched = new Set<string>()
    const afterStart = performance.now()
    await runBoundedConcurrent(
      candidates,
      LOOP_OPTS,
      makeProcessor(afterDispatched),
    )
    const afterMs = performance.now() - afterStart

    console.log(
      `[cron perf] offices=${offices.length} candidates=${candidates.length} ` +
        `before(serial,all)=${beforeMs.toFixed(1)}ms ` +
        `after(concurrent,prefiltered)=${afterMs.toFixed(1)}ms ` +
        `speedup=${(beforeMs / afterMs).toFixed(1)}x`,
    )

    // Same offices dispatch under both shapes (no outcome change).
    expect([...afterDispatched].sort()).toEqual([...beforeDispatched].sort())
    // The after path is comfortably faster; margin is wide enough to absorb
    // scheduler jitter.
    expect(afterMs).toBeLessThan(beforeMs * 0.6)
  })

  it('pre-filter reduces the processed-office count (K of M)', () => {
    const offices = buildOffices()
    const candidates = offices.filter(passesPrefilter)

    console.log(
      `[cron perf] pre-filter row reduction: ${offices.length} -> ${candidates.length} ` +
        `(${((1 - candidates.length / offices.length) * 100).toFixed(
          0,
        )}% fewer offices processed)`,
    )

    expect(candidates.length).toBeLessThan(offices.length)
    // Only the truly-eligible offices should remain after the guard runs.
    const dispatchers = offices.filter(officeWouldDispatch)
    expect(dispatchers.length).toBeGreaterThan(0)
  })

  it('pre-filter never drops an office that would have dispatched', () => {
    const offices = buildOffices()

    // Safety invariant: every office that dispatches passes the pre-filter, so
    // narrowing the findMany can never hide a dispatch-eligible office.
    for (const o of offices) {
      if (officeWouldDispatch(o)) {
        expect(passesPrefilter(o)).toBe(true)
      }
    }

    // And nothing the pre-filter excludes could have dispatched anyway.
    for (const o of offices.filter((x) => !passesPrefilter(x))) {
      expect(officeWouldDispatch(o)).toBe(false)
    }
  })

  it('concurrency does not change which offices dispatch', async () => {
    const offices = buildOffices()
    const candidates = offices.filter(passesPrefilter)

    // Old world: serial over ALL offices.
    const serialAll = new Set<string>()
    await runSerial(offices, LOOP_OPTS, makeProcessor(serialAll))

    // New world: bounded concurrency over PRE-FILTERED offices.
    const concurrentFiltered = new Set<string>()
    await runBoundedConcurrent(
      candidates,
      LOOP_OPTS,
      makeProcessor(concurrentFiltered),
    )

    const expected = offices
      .filter(officeWouldDispatch)
      .map((o) => o.id)
      .sort()

    expect([...serialAll].sort()).toEqual(expected)
    expect([...concurrentFiltered].sort()).toEqual(expected)
  })
})
