import { monitorEventLoopDelay } from 'node:perf_hooks'

/** p99 event-loop delay above which machine reads are refused. A healthy task
 * sits under ~20ms; the dev task that failed its health checks on 2026-10-29
 * reported 1.0 to 1.6s for minutes (ENG-11524). */
export const EVENT_LOOP_LAG_SHED_MS = 500
const WINDOW_MS = 5_000

const histogram = monitorEventLoopDelay({ resolution: 20 })
let previousWindowP99Ms = 0
let timer: NodeJS.Timeout | undefined

function start() {
  if (timer) return
  histogram.enable()
  timer = setInterval(() => {
    previousWindowP99Ms = histogram.percentile(99) / 1e6
    histogram.reset()
  }, WINDOW_MS)
  timer.unref()
}

/** The worse of the current and the previous 5s window, so a reset does not
 * briefly look like a recovery. Starts sampling on first use. */
export function recentEventLoopLagMs(): number {
  start()
  return Math.max(previousWindowP99Ms, histogram.percentile(99) / 1e6)
}
