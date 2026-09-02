import { describe, expect, it } from 'vitest'
import { GLOBAL_ALERTS } from '../alerts'
import { Alert } from './alerts.types'

// Mirrors grafana.ts's `alert.timeRangeSeconds ?? 600` — the window the
// alerting engine actually fetches when an alert does not pin its own.
const DEFAULT_FETCH_SECONDS = 600

// Mirrors grafana.ts's `alert.evaluationIntervalSeconds ?? 60` — how often a
// rule group is evaluated when a rule does not pin its own.
const DEFAULT_EVALUATION_SECONDS = 60

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

const toSeconds = (amount: string, unit: string) =>
  Number(amount) * (UNIT_SECONDS[unit.charAt(0)] ?? 0)

/** Seconds covered by the widest range vector in a LogQL expression. */
const widestRangeSeconds = (expr: string) => {
  const matches = [...expr.matchAll(/\[(\d+)([smhd])\]/g)]
  if (matches.length === 0) throw new Error(`no range vector in expr: ${expr}`)
  return Math.max(
    ...matches.map(([, amount, unit]) => toSeconds(amount!, unit!)),
  )
}

/** Seconds the notification tells the reader it looked back over. */
const promisedSeconds = (message: string) => {
  const match = /in the last (\d+) (seconds|minutes|hours)/.exec(message)
  const [, amount, unit] = match ?? []
  if (!amount || !unit) {
    throw new Error(`message does not state a numeric window: ${message}`)
  }
  return toSeconds(amount, unit)
}

describe('public-campaigns-lookup-error-ratio', () => {
  const alert = GLOBAL_ALERTS.find(
    (a) => a.slug === 'public-campaigns-lookup-error-ratio',
  )

  it('is registered', () => {
    expect(alert).toBeDefined()
  })

  it('keeps every range vector inside the window the engine fetches', () => {
    const fetched = alert!.timeRangeSeconds ?? DEFAULT_FETCH_SECONDS
    expect(widestRangeSeconds(alert!.expr)).toBeLessThanOrEqual(fetched)
  })

  it('promises the reader the window it actually queried', () => {
    expect(promisedSeconds(alert!.message)).toEqual(
      widestRangeSeconds(alert!.expr),
    )
  })

  // The whole point of this rule. The generated per-route alert triggers on a
  // single error in the window; on a route taking ~2 req/s with a standing
  // error rate that fires forever and gets muted, which is the failure mode
  // this endpoint already lived through by having no alert at all.
  it('is a ratio, not an any-error count', () => {
    expect(alert!.threshold).toBeGreaterThan(0)
    expect(alert!.threshold).toBeLessThan(1)
    expect(alert!.expr).toContain('/')
  })

  // 404 is this endpoint's answer for "this candidate has not claimed a
  // profile" and is ~95% of its traffic. In the numerator it would be absurd;
  // in the denominator it dilutes a total outage down to single-digit percent.
  it('counts only server errors, against resolvable lookups', () => {
    expect(alert!.expr).toContain('response_statusCode >= 500')
    expect(alert!.expr).not.toContain('response_statusCode >= 400')
    expect(alert!.expr).toContain('response_statusCode != 404')
  })

  // Without a floor, a quiet window turns one stray 500 into a page.
  it('holds fire below a minimum volume of resolvable lookups', () => {
    expect(alert!.expr).toMatch(/and .*> \d+/s)
  })
})

/**
 * How many times a day a rule re-reads the same logs. Loki bills the bytes an
 * evaluation decompresses, and an evaluation decompresses its whole fetch
 * window, so a rule's daily read volume is proportional to window ÷ interval
 * and to nothing else about the query.
 */
const rereadFactor = (alert: Alert) =>
  (alert.timeRangeSeconds ?? DEFAULT_FETCH_SECONDS) /
  (alert.evaluationIntervalSeconds ?? DEFAULT_EVALUATION_SECONDS)

// The two 6h rules sat at 360 on the 60s default and were between them the
// largest single line in the Loki query bill. This ceiling is what stops a
// wide fetch window being paired with a fast interval again; it is not a
// target, and a rule near it is still worth a second look.
const MAX_REREAD_FACTOR = 100

describe('evaluation intervals', () => {
  it('never pairs a wide fetch window with a fast interval', () => {
    const offenders = GLOBAL_ALERTS.filter(
      (alert) => rereadFactor(alert) > MAX_REREAD_FACTOR,
    ).map((alert) => `${alert.slug}: ${rereadFactor(alert)} re-reads/day`)

    expect(offenders).toEqual([])
  })

  // `for` is counted in whole evaluations, so an interval that does not divide
  // it evenly pushes firing latency out to the next evaluation without saying
  // so anywhere. Keeping the two commensurate means the `for` a reader sees is
  // the delay they actually get.
  it('keeps `for` a whole number of evaluation intervals', () => {
    const slowAlerts = GLOBAL_ALERTS.filter(
      (alert) => alert.evaluationIntervalSeconds !== undefined,
    )
    expect(slowAlerts.length).toBeGreaterThan(0)

    for (const alert of slowAlerts) {
      const forSeconds = toSeconds(alert.for.slice(0, -1), alert.for.slice(-1))

      expect(forSeconds % alert.evaluationIntervalSeconds!).toEqual(0)
    }
  })
})
