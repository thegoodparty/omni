import { describe, expect, it } from 'vitest'
import { GLOBAL_ALERTS } from '../alerts'
import { Alert } from './alerts.types'
import { GEOAPIFY_DAILY_CREDIT_POOL } from './geoapify-budget-alerts'

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

describe('geoapify daily budget tiers', () => {
  const tiers = GLOBAL_ALERTS.filter((a) =>
    a.slug.startsWith('geoapify-daily-budget-'),
  )

  it('registers one rule per tier', () => {
    expect(tiers.map((a) => a.slug)).toEqual([
      'geoapify-daily-budget-60',
      'geoapify-daily-budget-80',
      'geoapify-daily-budget-90',
      'geoapify-daily-budget-95',
    ])
  })

  it('keeps every range vector inside the window the engine fetches', () => {
    for (const alert of tiers) {
      const fetched = alert.timeRangeSeconds ?? DEFAULT_FETCH_SECONDS
      expect(widestRangeSeconds(alert.expr)).toBeLessThanOrEqual(fetched)
    }
  })

  it('promises the reader the window it actually queried', () => {
    for (const alert of tiers) {
      expect(promisedSeconds(alert.message)).toEqual(
        widestRangeSeconds(alert.expr),
      )
    }
  })

  // The escalation only means anything if the thresholds are the stated
  // fractions of the pool. A tier whose number drifted off its own percentage
  // would page under a name that misdescribes it.
  //
  // Rounds on the expected side too, as the implementation does. 50,000
  // divides evenly by all four percentages so the two agree today, but the
  // pool is a hand-maintained constant that exists to be corrected — a plan
  // upgrade landing on a figure that does not divide evenly would otherwise
  // fail this against a fractional expectation the implementation is right
  // not to produce.
  it('sets each threshold to its percentage of the daily pool', () => {
    expect(tiers.map((a) => a.threshold)).toEqual(
      [60, 80, 90, 95].map((p) =>
        Math.round((GEOAPIFY_DAILY_CREDIT_POOL * p) / 100),
      ),
    )
  })

  // Stated separately from the arithmetic above so that rounding cannot be
  // dropped from the implementation to satisfy it. A fractional threshold is
  // a credit count that cannot exist, and it reaches Grafana as one.
  it('gives the alerting engine whole credits', () => {
    for (const alert of tiers) {
      expect(Number.isInteger(alert.threshold)).toBe(true)
    }
  })

  // Identical text is what lets Loki's result cache serve tiers 2-4 from the
  // work tier 1 did — the reason four rules cost about what one does.
  it('shares one expression across the tiers', () => {
    expect(new Set(tiers.map((a) => a.expr)).size).toBe(1)
  })

  // Below the fast-burn ceiling a runaway would trip first, so the two alerts
  // stay in their intended order rather than racing.
  it('sits above the 6h fast-burn ceiling it complements', () => {
    const ceiling = GLOBAL_ALERTS.find(
      (a) => a.slug === 'door-knocking-route-planner-spend-ceiling',
    )
    expect(Math.min(...tiers.map((a) => a.threshold))).toBeGreaterThan(
      ceiling!.threshold,
    )
  })

  it('pages the team that owns door knocking', () => {
    for (const alert of tiers) expect(alert.notify).toBe('win-bugs')
  })
})

// The registry is the only place in this repo where a code change makes an
// alert stop reaching a human. Every rule below is about keeping that power
// narrow enough that misuse is a visible mistake rather than a quiet one.
describe('known causes', () => {
  const withCauses = GLOBAL_ALERTS.filter((a) => a.knownCauses?.length)

  const allCauses = withCauses.flatMap((alert) =>
    alert.knownCauses!.map((cause) => [alert, cause] as const),
  )

  it('is declared by at least one alert', () => {
    expect(withCauses.length).toBeGreaterThan(0)
  })

  // `id` is reported as a metric dimension, so the weekly digest groups
  // firings by it. Two causes sharing one id inside an alert merge into a
  // single row, and the row that reads "suppressed 40 times" would be hiding
  // two different decisions.
  it('gives each cause an id unique within its alert', () => {
    for (const alert of withCauses) {
      const ids = alert.knownCauses!.map((c) => c.id)
      expect(new Set(ids).size, `duplicate id in ${alert.slug}`).toBe(
        ids.length,
      )
    }
  })

  // Suppressing means nobody is told. Deciding that from the notification
  // alone is deciding it from text the rule wrote before the incident
  // happened, which cannot distinguish the benign case from the regression —
  // that indistinguishability is the reason the registry exists. So a
  // suppressing cause has to be confirmable against logs.
  it('makes every suppressing cause prove itself from logs', () => {
    for (const [alert, cause] of allCauses) {
      if (cause.action !== 'suppress') continue
      expect(cause.evidence, `${alert.slug}/${cause.id}`).toBeTruthy()
    }
  })

  // An evidence query without a line filter reads the whole stream for the
  // window, on every firing, and Loki bills decompressed bytes. The label
  // selector alone is not a query, it is a bill.
  it('narrows every evidence query past its label selector', () => {
    for (const [alert, cause] of allCauses) {
      if (!cause.evidence) continue
      expect(cause.evidence, `${alert.slug}/${cause.id}`).toMatch(
        /\|=|\|~|\|\s*json|\|\s*logfmt/,
      )
    }
  })

  // Evidence is substituted at provision time exactly like `expr`, so a query
  // that pins an environment literally would have the dev rule reading prod
  // logs to decide what to hide from a dev channel.
  it('leaves the environment for provisioning to fill in', () => {
    for (const [alert, cause] of allCauses) {
      if (!cause.evidence) continue
      const pinned = /deployment_environment_name="(?!\$ENV)/.test(
        cause.evidence,
      )
      expect(pinned, `${alert.slug}/${cause.id} pins an environment`).toBe(
        false,
      )
    }
  })

  // `confirmedBy` is what the classifier checks the logs against. Phrased as
  // a hint it is unfalsifiable, and an unfalsifiable condition is one that
  // confirms for any output it is shown — which for a suppressing cause means
  // suppressing everything the alert ever does.
  it('states each confirmation as a checkable condition', () => {
    for (const [alert, cause] of allCauses) {
      expect(cause.confirmedBy, `${alert.slug}/${cause.id}`).not.toMatch(
        /^\s*(look for|check for|see if|probably|maybe|might be)\b/i,
      )
      expect(
        cause.confirmedBy.length,
        `${alert.slug}/${cause.id} is too terse to check`,
      ).toBeGreaterThan(20)
    }
  })

  // A suppressing cause with no ticket is how a known issue becomes a
  // permanently invisible one: the alert stops arriving and nothing is left
  // pointing at the work. This is not an error — shipping the mechanism
  // before the tickets exist is reasonable — but the digest has to be able to
  // name them, so the set is asserted explicitly and changing it is a
  // deliberate edit rather than a side effect.
  it('accounts for suppressing causes that track no ticket', () => {
    const untracked = allCauses
      .filter(([, cause]) => cause.action === 'suppress' && !cause.ticket)
      .map(([alert, cause]) => `${alert.slug}/${cause.id}`)

    expect(untracked).toEqual([
      'door-knocking-pack-build-failed/people-db-statement-timeout',
    ])
  })
})
