import { describe, expect, it } from 'vitest'
import { GLOBAL_ALERTS } from '../alerts'
import { Alert, RecordingRule } from './alerts.types'
import { GEOAPIFY_DAILY_CREDIT_POOL } from './geoapify-budget-alerts'
import { logSignalExpr } from './log-signals'
import { RECORDING_RULES } from './provisioned-alerts'

// Since 2026-09-29 no hand-written global alert queries Loki: each reads a
// recorded signal instead, and the LogQL that decides WHAT is counted lives on
// the recording rule. The assertions below are about what is counted, so this is
// where they have to look. The alert is still the right place to assert the
// window, the threshold and the prose.
const CAMPAIGN_ERRORS = 'gp_api:public_campaign_lookup_errors:count1m'
const CAMPAIGN_RESOLVABLE = 'gp_api:public_campaign_lookups_resolvable:count1m'
const PROFILE_ERRORS = 'gp_api:public_person_profile_errors:count1m'
const PROFILE_RESOLVABLE =
  'gp_api:public_person_profile_lookups_resolvable:count1m'
const REPOINT_COLLISIONS = 'gp_api:person_id_repoint_collisions:count1m'

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
    expect(logSignalExpr(CAMPAIGN_ERRORS)).toContain(
      'response_statusCode >= 500',
    )
    expect(logSignalExpr(CAMPAIGN_ERRORS)).not.toContain(
      'response_statusCode >= 400',
    )
    expect(logSignalExpr(CAMPAIGN_RESOLVABLE)).toContain(
      'response_statusCode != 404',
    )
  })

  // Both halves read the recorded signal, and the volume floor reads the very
  // same series as the denominator. A floor measured against a different
  // population from the ratio it qualifies is the bug the null-status clause
  // was added to both halves of the sibling rule to avoid.
  it('measures its floor against the same population as its ratio', () => {
    const occurrences =
      alert!.expr.match(new RegExp(CAMPAIGN_RESOLVABLE, 'g')) ?? []
    expect(occurrences.length).toBe(2)
  })

  // Without a floor, a quiet window turns one stray 500 into a page.
  it('holds fire below a minimum volume of resolvable lookups', () => {
    expect(alert!.expr).toMatch(/and .*> \d+/s)
  })
})

// The rule that was missing when GET /v1/public-person-profiles/voter-density
// answered 1,498,324 consecutive requests with a 500 over four days. It is the
// same shape as the public-campaigns rule above and is asserted separately
// rather than shared with it, because "modelled on" is not "identical to": it
// groups where the sibling totals, and a property that holds for a single
// ratio has to be re-established once the expression returns many.
describe('public-person-profiles-error-ratio', () => {
  const alert = GLOBAL_ALERTS.find(
    (a) => a.slug === 'public-person-profiles-error-ratio',
  )

  it('is registered', () => {
    expect(alert).toBeDefined()
  })

  // A range vector wider than the window the engine fetches is never fully
  // populated, so the rule silently judges on part of the data it claims.
  it('keeps every range vector inside the window the engine fetches', () => {
    const fetched = alert!.timeRangeSeconds ?? DEFAULT_FETCH_SECONDS
    expect(widestRangeSeconds(alert!.expr)).toBeLessThanOrEqual(fetched)
  })

  it('promises the reader the window it actually queried', () => {
    expect(promisedSeconds(alert!.message)).toEqual(
      widestRangeSeconds(alert!.expr),
    )
  })

  // Same reasoning as the sibling, and the reason this controller is not
  // simply added to ALERT_OWNERSHIP: the generated rule fires on one error in
  // the window, and these routes serve ~4 req/s, so it would sit permanently
  // lit and be muted — which is indistinguishable from the silence it replaced.
  it('is a ratio, not an any-error count', () => {
    expect(alert!.threshold).toBeGreaterThan(0)
    expect(alert!.threshold).toBeLessThan(1)
    expect(alert!.expr).toContain('/')
  })

  // Most requests here are meant to miss: gp-marketing asks about every
  // candidate, and a person who maps to no L2 district has no heat map to
  // return. 1.8M such misses in a week would bury a total outage in a rounding
  // error. Against non-404s the August failure reads 100%.
  it('counts only server errors, against lookups that were meant to resolve', () => {
    expect(logSignalExpr(PROFILE_ERRORS)).toContain(
      'response_statusCode >= 500',
    )
    expect(logSignalExpr(PROFILE_ERRORS)).not.toContain(
      'response_statusCode >= 400',
    )
    expect(logSignalExpr(PROFILE_RESOLVABLE)).toContain(
      'response_statusCode != 404',
    )
  })

  // Per route, so a quiet route cannot page on a single 500. The series drops
  // out below the floor, which grafana.ts maps to OK via noDataState.
  it('holds fire below a minimum volume of resolvable lookups', () => {
    expect(alert!.expr).toMatch(/and .*> \d+/s)
  })

  // What this rule has and the sibling does not. Grafana turns each returned
  // series into its own alert instance, so a route that is entirely broken is
  // judged on its own numbers instead of being averaged out by a busier
  // sibling that is fine. In August the base route was healthy and served more
  // traffic than the one that was down, so a single controller-wide ratio
  // would have stayed well under any threshold worth setting.
  it('splits by route, so a dead route is not averaged out by a healthy one', () => {
    expect(alert!.expr).toContain('sum by (request_endpoint)')
  })

  // The grouping only reaches the responder if the notification says which
  // route fired. Grouping without naming the label produces several identical
  // messages and no way to tell them apart.
  it('names the route it fired for', () => {
    expect(alert!.summaryDetail).toContain('{{ $labels.request_endpoint }}')
    expect(alert!.message).toContain('{{ $labels.request_endpoint }}')
  })

  // The complaint this alert answers is that a route can ship with nobody
  // watching it. An exact alternation of today's routes would reproduce that
  // by needing to be remembered; the prefix regex covers a new route on the
  // controller the day it ships.
  it('covers routes added to the controller later', () => {
    for (const metric of [PROFILE_ERRORS, PROFILE_RESOLVABLE]) {
      expect(logSignalExpr(metric), metric).toContain(
        '/v1/public-person-profiles(/.*)?$',
      )
    }
  })

  // The worst answer a route can give is none, and it is the one a status
  // range cannot see: a request the gateway kills mid-flight completes with a
  // null status, which Loki's json parser drops, so `>= 500` misses it. The
  // generated rules learned this from two door-knocking timeouts that went
  // unseen in August (see noStatusFilter in controller-alerts.ts), and a
  // hand-written rule gets no benefit from that unless it says so itself.
  it('counts a request that was killed before it could answer', () => {
    expect(logSignalExpr(PROFILE_ERRORS)).toContain(
      '( response_statusCode >= 500 ) or ( response_statusCode = "" )',
    )
  })

  // And in the denominator too. Failures that are not also traffic push the
  // ratio above 100% during a pure timeout wave, and leave the volume floor
  // guarding a smaller population than the ratio it is supposed to qualify.
  // Three occurrences: once as a failure, and once in each of the two places
  // the non-404 population is counted — the ratio, and the floor.
  it('counts that request as traffic as well as as a failure', () => {
    expect(logSignalExpr(PROFILE_RESOLVABLE)).toContain(
      '( response_statusCode != 404 ) or ( response_statusCode = "" )',
    )

    // Once in each signal, where it used to be three times in one expression:
    // the ratio's denominator and the volume floor now read the same recorded
    // series, so the population they measure cannot differ.
    for (const metric of [PROFILE_ERRORS, PROFILE_RESOLVABLE]) {
      const occurrences =
        logSignalExpr(metric).match(/response_statusCode = ""/g) ?? []
      expect(occurrences.length, metric).toBe(1)
    }

    const floorAndRatio =
      alert!.expr.match(new RegExp(PROFILE_RESOLVABLE, 'g')) ?? []
    expect(floorAndRatio.length).toBe(2)
  })

  // The prose is what the responder reads at 3am, and a rule that pages on a
  // null status while describing itself as a server-error rule sends them
  // looking for an exception that was never raised.
  it('tells the reader that a null status is one of the things it counts', () => {
    expect(alert!.message).toContain('null')
    expect(alert!.message).toContain('responseTimeMs')
  })
})

/**
 * How many times a day a rule re-reads the same logs. Loki bills the bytes an
 * evaluation decompresses, and an evaluation decompresses its whole fetch
 * window, so a rule's daily read volume is proportional to window ÷ interval
 * and to nothing else about the query.
 *
 * It is also, conveniently, the rule's daily read volume expressed as a
 * multiple of what we ingest — which is the unit the allowance is denominated
 * in. A rule at 96 reads 96x our ingest per day.
 */
const rereadFactor = (alert: Alert | RecordingRule) =>
  'metric' in alert
    ? (alert.fromSeconds - alert.toSeconds) / alert.intervalSeconds
    : (alert.timeRangeSeconds ?? DEFAULT_FETCH_SECONDS) /
      (alert.evaluationIntervalSeconds ?? DEFAULT_EVALUATION_SECONDS)

/**
 * Everything we provision that reads a log stream on a schedule.
 *
 * The alerts and the recording rules together, because they spend one budget.
 * A rule moved onto a recorded metric stops appearing in the first list and
 * starts appearing in the second, and the total is what has to hold.
 */
const scheduledLokiReads = (): (Alert | RecordingRule)[] => [
  ...GLOBAL_ALERTS.filter((alert) => alert.type === 'log'),
  ...RECORDING_RULES,
]

/**
 * The most of the allowance any single rule may be budgeted for.
 *
 * WHY THIS NUMBER IS NOT 100, WHICH IS WHAT IT USED TO BE. The plan includes
 * log queries up to 100x ingest, so a per-rule ceiling of 100 permitted any one
 * rule to consume the entire allowance and still pass. The four Geoapify budget
 * tiers each did exactly that, at 96 apiece — passing individually, and together
 * budgeted at 384% of everything we are allowed to read. On 2026-09-29 the
 * account was measured at 4.4x the allowance with production perfectly healthy.
 *
 * A per-rule cap can only ever be a sanity check; the real constraint is the
 * total below. This is set at the one log-backed rule we still have, so anything
 * wider than a 6h window on a 30-minute interval has to become a recording rule
 * rather than a slower alert.
 */
const MAX_REREAD_FACTOR = 12

/**
 * The most of the allowance every scheduled read may be budgeted for, together.
 *
 * The allowance is 100x ingest and it is shared three ways this number has to
 * respect: every rule in the set, BOTH environments (dev and prod provision the
 * same definitions and each reads its own stream, so the pair spends the sum),
 * and ad-hoc queries — measured at 149 GB/day on 2026-09-29, about 14% of the
 * allowance, which nothing in a test can bound.
 *
 * AND IT HAS TO BE SET AGAINST PEAK TRAFFIC, which is the part that caught us
 * out. A rule's cost scales with the volume of the stream it selects —
 * `{service_name="gp-api", deployment_environment_name="prod"}` — while the
 * allowance scales with total account ingest, gp-api dev and election-api
 * included. gp-api prod is a small share of that overnight and a large one at
 * midday: 67.8 MB/h at 07:30 UTC on 2026-09-29, 281 MB/h at 09:30. So an
 * unchanged rule set that measured 0.79 of the allowance at 08:30 measured 2.84
 * at 10:30. A factor budget is therefore not scale-invariant, and it drifts
 * upward as the product grows.
 *
 * Calibration, at that peak rather than at the overnight floor: the set totalled
 * 161 in effective factor and the account read 3,095 GB/day against a 1,108
 * GB/day allowance, i.e. ~19 GB/day per unit. 40 therefore predicts ~770
 * GB/day, about 70% of the allowance in the worst hour measured and far less
 * the rest of the day. The set totals 27 today, all but 12 of it recording
 * rules, which is as close to the floor as this estate gets.
 *
 * The factor is a per-rule lower bound rather than an exact cost: until
 * 2026-09-29 the two error-ratio rules evaluated their stream three times inside
 * one expression (numerator, denominator, volume floor), so each cost about
 * three times what its factor said. Both read a recorded metric now, but a new
 * rule that repeats a leg would do the same thing again.
 *
 * If this test fails, the answer is almost never a bigger number here, and it is
 * not a slower interval either — that buys cost with detection latency on the
 * rules least able to afford it. It is a recording rule: one Loki read a minute,
 * shared by every alert that wants a window wider than a minute, at no latency
 * cost at all. See log-signals.ts.
 */
const MAX_TOTAL_REREAD_FACTOR = 40

describe('people-person-id-repoint-collision', () => {
  const alert = GLOBAL_ALERTS.find(
    (a) => a.slug === 'people-person-id-repoint-collision',
  )

  // Verbatim from person-id-backfill.service.ts::resyncLinkedUser, which is
  // the only thing that emits any of them. Mirrored rather than imported
  // because deploy/ does not compile against src/ — so this is the test that
  // notices when somebody rewords a log line and silently unhooks the alert
  // from the event it was written for.
  const COLLISION_LINES = [
    'person_id drift detected but the destination id is already occupied; left unchanged for manual resolution',
    'person_id repoint lost a race to a concurrent write; left unchanged',
  ]
  const SELF_CORRECTING_LINES = [
    'person_id repoint failed; the link is still stale',
    'person_id drift repaired; gp-api rows repointed at the surviving person',
  ]

  /**
   * The `|= "..."` and `|~ "..."` filters, as the matcher Loki would apply.
   *
   * Read off the recorded signal rather than off the alert, which is PromQL
   * since 2026-09-29. The filters are what these tests are about, so they follow
   * the filters.
   */
  const signal = logSignalExpr(REPOINT_COLLISIONS)
  const matchesExpr = (line: string) => {
    const [, literal] = /\|= "([^"]+)"/.exec(signal) ?? []
    const [, pattern] = /\|~ "([^"]+)"/.exec(signal) ?? []
    if (!literal || !pattern) throw new Error(`no filters in: ${signal}`)
    return line.includes(literal) && new RegExp(pattern).test(line)
  }

  it('is registered', () => {
    expect(alert).toBeDefined()
  })

  it('keeps every range vector inside the window the engine fetches', () => {
    const fetched = alert!.timeRangeSeconds ?? DEFAULT_FETCH_SECONDS
    expect(widestRangeSeconds(alert!.expr)).toBeLessThanOrEqual(fetched)
  })

  // The sweep runs `0 4 * * *`. A window shorter than the gap between runs
  // would leave most of the day reporting zero for a condition that is still
  // true and still waiting on a person.
  it('spans hours, not minutes, because the sweep is daily', () => {
    expect(widestRangeSeconds(alert!.expr)).toBeGreaterThanOrEqual(6 * 3600)
  })

  it('catches both ways the repoint is abandoned', () => {
    for (const line of COLLISION_LINES) {
      expect(matchesExpr(line), line).toBe(true)
    }
  })

  // The other three outcomes of `resyncLinkedUser` fix themselves on the next
  // sweep. Paging on those is how this rule would get muted, and a muted rule
  // is worth less than no rule.
  it('ignores the outcomes that retry themselves', () => {
    for (const line of SELF_CORRECTING_LINES) {
      expect(matchesExpr(line), line).toBe(false)
    }
  })

  // Loki bills the bytes an evaluation decompresses, and a regex alternation
  // is applied to every line the selector returns. The cheap literal in front
  // is what keeps a 6h window affordable.
  it('narrows with a literal before applying the alternation', () => {
    expect(signal.indexOf('|= "')).toBeLessThan(signal.indexOf('|~ "'))
  })

  // Unrouted alerts land on the default receiver. This one names a human
  // action nobody is otherwise told to take, so it goes to the rotation that
  // owns the people surface.
  it('pages a group rather than the default receiver', () => {
    expect(alert!.notify).toEqual('win-bugs')
  })
})

describe('evaluation intervals', () => {
  it('never pairs a wide fetch window with a fast interval', () => {
    const offenders = scheduledLokiReads()
      .filter((rule) => rereadFactor(rule) > MAX_REREAD_FACTOR)
      .map((rule) => `${rule.slug}: ${rereadFactor(rule)} re-reads/day`)

    expect(offenders).toEqual([])
  })

  // The test that was missing. Every rule above can pass its own ceiling while
  // the set as a whole is many times over the allowance, because the allowance
  // is one number shared by all of them — and it was: 787 against 100 on
  // 2026-09-29, spending 4.4x what the plan includes while production was fine.
  it('leaves most of the query allowance unspent, across every rule', () => {
    const reads = scheduledLokiReads()
    const total = reads.reduce((sum, rule) => sum + rereadFactor(rule), 0)

    const breakdown = reads
      .map((rule) => `${rule.slug}: ${rereadFactor(rule)}`)
      .sort()
      .join('\n')

    expect(total, `total ${total}x ingest\n${breakdown}`).toBeLessThanOrEqual(
      MAX_TOTAL_REREAD_FACTOR,
    )
  })

  // Not a cost property but the one that makes the cost property readable: a
  // rule that says `type: 'log'` and then selects a Prometheus metric, or the
  // reverse, would be counted in the wrong set above.
  it('keeps every log rule on a Loki stream selector', () => {
    for (const alert of GLOBAL_ALERTS.filter((a) => a.type === 'log')) {
      expect(alert.expr, alert.slug).toContain('service_name="gp-api"')
    }
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

// The two structural properties of a recording rule, asserted over every one
// we provision rather than only over the route pair in controller-alerts.test.
// A rule that reads a wider window than its interval is the defect that
// produced 2,690 GB/day and the 2026-09-28 429s; a rule that reads up to `now`
// loses lines permanently. Neither is visible in Grafana when it is wrong.
describe('recording rules', () => {
  it('reads each log line exactly once', () => {
    for (const rule of RECORDING_RULES) {
      const width = [...rule.expr.matchAll(/\[(\d+)([smhd])\]/g)].map(
        ([, amount, unit]) => toSeconds(amount!, unit!),
      )

      expect(width, rule.slug).toHaveLength(1)
      expect(rule.fromSeconds - rule.toSeconds, rule.slug).toEqual(width[0])
      expect(width[0], rule.slug).toEqual(rule.intervalSeconds)
    }
  })

  // Log lines reach Loki several seconds after the request they describe, so a
  // window ending at `now` misses the newest ones and never sees them again:
  // the next evaluation's window starts where this one ended.
  it('ends its window before now, to clear the ingestion lag', () => {
    for (const rule of RECORDING_RULES) {
      expect(rule.toSeconds, rule.slug).toBeGreaterThan(0)
    }
  })

  // Two rules writing one metric interleave two measurements into one series,
  // and nothing about the result looks wrong.
  it('writes one metric per rule', () => {
    const metrics = RECORDING_RULES.map((rule) => rule.metric)
    expect(new Set(metrics).size).toEqual(metrics.length)

    const slugs = RECORDING_RULES.map((rule) => rule.slug)
    expect(new Set(slugs).size).toEqual(slugs.length)
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

  // Four rules asking the same question should ask it in the same words: a
  // per-tier edit is how an escalation starts measuring four slightly
  // different things. This used to be justified by Loki's result cache serving
  // tiers 2-4 from tier 1's work, which per-rule attribution showed it did not
  // (13.6 / 11.2 / 11.2 / 7.2 GB/h on 2026-09-29) — they read a recorded
  // Prometheus metric now, so the cost argument is gone and only this one is
  // left.
  it('shares one expression across the tiers', () => {
    expect(new Set(tiers.map((a) => a.expr)).size).toBe(1)
  })

  // Both read the same recorded credit metric, so the comparison is between
  // two numbers measured the same way. Below the fast-burn ceiling a runaway
  // would trip first, so the two alerts stay in their intended order rather
  // than racing.
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

  // The failure the rule above does not catch, and it shipped once: a condition
  // that is phrased as a condition and still confirms for anything, because it
  // asks only whether the query returned something. "Matched lines exist and
  // name a schema path" is true of every output a query filtered to that shape
  // can produce, so the cause is confirmed by its own evidence gather.
  //
  // What separates the two is whether the entry says what would DISCONFIRM it.
  // A prose check is a blunt instrument, but the alternative is no check on the
  // one property that decides whether the classifier can ever answer no — and
  // the sibling entries were already written this way, so the shape being
  // asserted is the house style rather than a new requirement.
  it('says what would rule each cause out', () => {
    for (const [alert, cause] of allCauses) {
      expect(
        cause.confirmedBy,
        `${alert.slug}/${cause.id} states no disconfirming condition: say what a matched line, or the absence of one, would look like if this were NOT the cause`,
      ).toMatch(/\bis not\b|\bis NOT\b|\binstead\b|\bmissing\b|\bno matched\b/)
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

// The alert about the alerting, and the only rule in this file whose premise is
// that the other rules cannot be delivered. Everything asserted here is a
// property that makes it survive the outage it describes.
describe('alert-notification-delivery-failing', () => {
  const alert = GLOBAL_ALERTS.find(
    (a) => a.slug === 'alert-notification-delivery-failing',
  )!

  it('exists, because routing alerts through a Lambda makes that Lambda a single point of failure', () => {
    expect(alert).toBeDefined()
  })

  // gp-api's own metrics are useless here: the process can be perfectly healthy
  // while nothing it reports reaches a human. Only Grafana's view of its own
  // delivery attempts can see this.
  it('measures Grafana own delivery attempts rather than anything gp-api emits', () => {
    expect(alert.expr).toContain('alerting_notification_send_failures_total')
    expect(alert.expr).not.toContain('service_name="gp-api"')
  })

  // A subteam mention is added to the message BODY, and this rule's premise is
  // that the path carrying message bodies is broken — so a mention would travel
  // exactly as far as the thing it exists to escape. What makes this alert work
  // is its route, which lives in the notification policy tree and not here.
  it('pages nobody, because the mention would ride the broken path', () => {
    expect(alert.notify).toBeUndefined()
  })

  // The message has to carry the escape hatch, because whoever reads it is
  // reading it at the moment alerting is down and should not have to find a
  // runbook first.
  it('tells the reader how to restore alerting immediately', () => {
    expect(alert.message).toContain('repoint')
    expect(alert.message.toLowerCase()).toContain('slack contact point')
  })

  it('names the log group to look in', () => {
    expect(alert.message).toContain('alert-filter-prod')
  })

  // A delivery failure that cleared on its own is not worth interrupting
  // anyone for, but five minutes of them is the channel being down.
  it('waits long enough to exclude a single transient failure', () => {
    expect(alert.for).toBe('5m')
    expect(alert.threshold).toBe(0)
  })

  // It must not be routed through the filter, which is a policy-tree property
  // this repo cannot express — so the rule declares no known causes, because a
  // known cause would imply the filter gets to see it.
  it('declares no known causes, since the filter must never classify it', () => {
    expect(alert.knownCauses).toBeUndefined()
  })
})
