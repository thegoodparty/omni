import { describe, expect, it } from 'vitest'
import { GLOBAL_ALERTS } from '../alerts'
import { Alert, RecordingRule } from './alerts.types'
import { GEOAPIFY_DAILY_CREDIT_POOL } from './geoapify-budget-alerts'
import { RECORDING_RULES } from './provisioned-alerts'
import { routeErrorAlerts } from './route-alerts'

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

  // Without a floor, a quiet window turns one stray 500 into a page. The
  // floor filters the denominator in place, so under it there is nothing to
  // divide by and the rule reads no data.
  it('holds fire below a minimum volume of resolvable lookups', () => {
    expect(alert!.expr).toMatch(/\/ \( sum.*\[10m\]\)\) > \d+ \) \)$/s)
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
    expect(alert!.expr).toContain('response_statusCode >= 500')
    expect(alert!.expr).not.toContain('response_statusCode >= 400')
    expect(alert!.expr).toContain('response_statusCode != 404')
  })

  // Per route, so a quiet route cannot page on a single 500. The series drops
  // out below the floor, which grafana.ts maps to OK via noDataState.
  it('holds fire below a minimum volume of resolvable lookups', () => {
    expect(alert!.expr).toMatch(/\/ \( sum by .*\[10m\]\)\) > \d+ \) \)$/s)
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
    expect(alert!.expr).toContain('/v1/public-person-profiles(/.*)?$')
  })

  // The worst answer a route can give is none, and it is the one a status
  // range cannot see: a request the gateway kills mid-flight completes with a
  // null status, which Loki's json parser drops, so `>= 500` misses it. The
  // generated rules learned this from two door-knocking timeouts that went
  // unseen in August (see noStatusFilter in route-alerts.ts), and a
  // hand-written rule gets no benefit from that unless it says so itself.
  it('counts a request that was killed before it could answer', () => {
    expect(alert!.expr).toContain(
      '( response_statusCode >= 500 ) or ( response_statusCode = "" )',
    )
  })

  // And in the denominator too. Failures that are not also traffic push the
  // ratio above 100% during a pure timeout wave, and leave the volume floor
  // guarding a smaller population than the ratio it is supposed to qualify.
  // Two occurrences: once as a failure, and once in the non-404 population,
  // which the floor now filters in place rather than counting a second time.
  it('counts that request as traffic as well as as a failure', () => {
    expect(alert!.expr).toContain(
      '( response_statusCode != 404 ) or ( response_statusCode = "" )',
    )

    const occurrences = alert!.expr.match(/response_statusCode = ""/g) ?? []
    expect(occurrences.length).toBe(2)
  })

  // The prose is what the responder reads at 3am, and a rule that pages on a
  // null status while describing itself as a server-error rule sends them
  // looking for an exception that was never raised.
  it('tells the reader that a null status is one of the things it counts', () => {
    expect(alert!.message).toContain('null')
    expect(alert!.message).toContain('responseTimeMs')
  })
})

/** Seconds covered by every range vector in a LogQL expression, summed. */
const totalRangeSeconds = (expr: string) =>
  [...expr.matchAll(/\[(\d+)([smhd])\]/g)].reduce(
    (sum, [, amount, unit]) => sum + toSeconds(amount!, unit!),
    0,
  )

/**
 * How many times a day a rule re-reads the same logs. Loki bills the bytes an
 * evaluation decompresses. Log rules run as instant queries, which read each
 * range vector in the expression once and nothing else, so a rule's daily read
 * volume is the sum of its vectors ÷ its interval and nothing else about the
 * query changes it. A ratio with `[10m]` on each side of the division reads
 * twenty minutes per evaluation.
 *
 * It is also, conveniently, the rule's daily read volume as a multiple of the
 * gp-api prod stream, which is the only stream any of them selects. A rule at
 * 12 reads twelve days of gp-api prod logs every day.
 *
 * This used to be fetch window ÷ interval, and it undercounted by more than
 * half. The rules ran as range queries then, which read the fetch window PLUS
 * the vector, and the ratio rules counted their denominator twice.
 */
const rereadFactor = (alert: Alert | RecordingRule) =>
  'metric' in alert
    ? (alert.fromSeconds - alert.toSeconds) / alert.intervalSeconds
    : totalRangeSeconds(alert.expr) /
      (alert.evaluationIntervalSeconds ?? DEFAULT_EVALUATION_SECONDS)

/**
 * Everything we provision that reads a log stream on a schedule.
 *
 * THE ROUTE ALERTS ARE IN HERE NOW, AND THEIR ABSENCE WAS THE SECOND BUG. This
 * list walked `GLOBAL_ALERTS` only, so the generated route rules — which are
 * not members of it — were invisible to the one test that exists to stop the
 * estate outspending its allowance. On 2026-09-28 those rules were 75 reads of
 * the entire gp-api stream every minute, 750x ingest, and this test passed
 * while Grafana Cloud started answering 429 and every rule in the estate fired
 * at once. A budget check that cannot see the largest line item is not a budget
 * check.
 *
 * The three sources spend one budget, so they are summed as one. A rule moved
 * onto a recorded metric stops appearing in the log lists and starts appearing
 * in the recording list, and the total is what has to hold either way.
 */
const scheduledLokiReads = (): (Alert | RecordingRule)[] => [
  ...GLOBAL_ALERTS.filter((alert) => alert.type === 'log'),
  ...routeErrorAlerts().filter((alert) => alert.type === 'log'),
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
 * total below. This is set to leave no rule able to take a fifth of the budget
 * on its own.
 */
const MAX_REREAD_FACTOR = 24

/**
 * The most of the allowance every scheduled read may be budgeted for, together.
 *
 * The allowance is 100x ingest, and it is shared by every rule in this set and
 * by ad-hoc queries, which nothing in a test can bound (about 300 GB/day
 * averaged over the week to 2026-10-09, nearly all of it agents through the
 * Grafana MCP). Only prod provisions alerting, so the set is spent once.
 *
 * Calibration, so this is a measurement rather than a preference. One unit is
 * one day of the gp-api prod stream, which every rule here selects: on
 * 2026-10-09 an instant [10m] read of it was 19-21 MB at mid-morning traffic,
 * so a unit is 2-3 GB/day. At 120 that is 240-360 GB/day, a fifth to a
 * quarter of an allowance of ~1,250 GB/day (12.5 GB/day of ingest averaged
 * over the month), leaving the rest for humans and agents.
 *
 * The set totals 56 today: 7 for the seven event rules at the floor of 1, 5
 * for the five route rules, 1 for the door-knocking recording rule, and 43
 * for the six that need a window wider than their interval (the two ratio
 * rules at 2 each, run once per window, admin impersonation at 10, the two 6h rules at 12 each,
 * the email lookup at 5). Before the move to instant queries and the removal
 * of dev alerting the same rules cost about 340 per environment, twice over.
 *
 * A rule that fires on any occurrence of a line belongs at the floor: a [1m]
 * window every minute with `keepFiringFor` (EVENT RULES in alerts.ts). A rule
 * that needs a wide window pays that width every evaluation, so that is where
 * the headroom goes.
 *
 * If this test fails, the answer is almost never a bigger number here. It is
 * a narrower window, a slower interval, or a recording rule: one Loki read a
 * minute, shared by every alert that wants a window wider than a minute. See
 * RECORDING_RULES in provisioned-alerts.ts.
 */
const MAX_TOTAL_REREAD_FACTOR = 120

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

  /** The `|= "..."` and `|~ "..."` filters, as the matcher Loki would apply. */
  const matchesExpr = (line: string) => {
    const [, literal] = /\|= "([^"]+)"/.exec(alert!.expr) ?? []
    const [, pattern] = /\|~ "([^"]+)"/.exec(alert!.expr) ?? []
    if (!literal || !pattern) throw new Error(`no filters in: ${alert!.expr}`)
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
    expect(alert!.expr.indexOf('|= "')).toBeLessThan(
      alert!.expr.indexOf('|~ "'),
    )
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

  // Log rules are instant queries, so what a rule reads is its range vector
  // and the window Grafana shows is only a label. Holding the two equal keeps
  // that label true: the rule list, the message and the bill describe the
  // same span.
  it('shows every log rule the window it reads', () => {
    const mismatched = scheduledLokiReads()
      .filter((rule): rule is Alert => !('metric' in rule))
      .filter(
        (rule) =>
          (rule.timeRangeSeconds ?? DEFAULT_FETCH_SECONDS) !==
          widestRangeSeconds(rule.expr),
      )
      .map((rule) => rule.slug)

    expect(mismatched).toEqual([])
  })

  // A window narrower than the interval leaves a gap no evaluation reads, and
  // a line in it never pages. Equal is the floor, which is what the event
  // rules and the route rules sit at.
  it('leaves no gap between one evaluation and the next', () => {
    const gapped = scheduledLokiReads()
      .filter((rule): rule is Alert => !('metric' in rule))
      .filter(
        (rule) =>
          widestRangeSeconds(rule.expr) <
          (rule.evaluationIntervalSeconds ?? DEFAULT_EVALUATION_SECONDS),
      )
      .map((rule) => rule.slug)

    expect(gapped).toEqual([])
  })

  // `keepFiringFor` only holds through an evaluation that ran and failed its
  // threshold. An idle count returns no series, `noDataState: OK` resets the
  // alert to Normal, and the hold is skipped, so a burst a minute apart pages
  // twice. The explicit zero is what keeps the idle minute an evaluation.
  it('makes every held rule evaluate to zero when idle', () => {
    const held = [...GLOBAL_ALERTS, ...routeErrorAlerts()].filter(
      (alert) => alert.type === 'log' && alert.keepFiringFor !== undefined,
    )
    expect(held.length).toBeGreaterThan(0)

    for (const alert of held) {
      expect(alert.expr, alert.slug).toMatch(/ or vector\(0\)$/)
    }
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

  it('keeps every route alert on a Loki stream selector', () => {
    for (const alert of routeErrorAlerts()) {
      expect(alert.type, alert.slug).toBe('log')
      expect(alert.expr, alert.slug).toContain('service_name="gp-api"')
    }
  })

  // `for` is counted in whole evaluations, so an interval that does not divide
  // it evenly pushes firing latency out to the next evaluation without saying
  // so anywhere. Keeping the two commensurate means the `for` a reader sees is
  // the delay they actually get.
  it('keeps `for` a whole number of evaluation intervals', () => {
    const slowAlerts = [...GLOBAL_ALERTS, ...routeErrorAlerts()].filter(
      (alert) => alert.evaluationIntervalSeconds !== undefined,
    )
    expect(slowAlerts.length).toBeGreaterThan(0)

    for (const alert of slowAlerts) {
      const forSeconds = toSeconds(alert.for.slice(0, -1), alert.for.slice(-1))

      expect(forSeconds % alert.evaluationIntervalSeconds!, alert.slug).toEqual(
        0,
      )
    }
  })
})

/**
 * Every `gp_api:` series an alert selects, as the alert that selects it.
 *
 * The prefix is the convention for a metric this repo records rather than one a
 * service exports, so a match here is a claim that some recording rule produces
 * it. Nothing else in Prometheus is named this way.
 */
const recordedMetricReaders = (): { slug: string; metric: string }[] =>
  GLOBAL_ALERTS.flatMap((alert) =>
    [...alert.expr.matchAll(/gp_api:[a-z_:0-9]+/g)].map(([metric]) => ({
      slug: alert.slug,
      metric,
    })),
  )

describe('recorded metrics', () => {
  /**
   * THE CHEAP HALF OF THE 2026-09-28 GUARD, and it is important to be exact
   * about which half.
   *
   * This catches an alert wired to a metric nothing produces: a typo, a rename,
   * or a recording rule deleted out from under its consumers. It would NOT have
   * caught the actual outage, because the rules existed, were named correctly,
   * and were read correctly — they simply never wrote, and no assertion over
   * these definitions can see that. Writing is observed in production by
   * `recorded-metric-not-writing`, which watches the metric rather than the
   * rule, and that alert is the real guard.
   *
   * Both are needed and neither substitutes for the other: this one fails a PR,
   * that one pages an on-call.
   */
  it('reads only metrics a provisioned recording rule writes', () => {
    const produced = new Set(RECORDING_RULES.map((rule) => rule.metric))
    const orphans = recordedMetricReaders()
      .filter(({ metric }) => !produced.has(metric))
      .map(({ slug, metric }) => `${slug} reads ${metric}`)

    expect(orphans).toEqual([])
  })

  /**
   * A recording rule is only watchable if absence means one thing.
   *
   * `recorded-metric-not-writing` pages when the metric has no samples for 30
   * minutes. That is only a fault signal if the rule writes in every interval,
   * including the intervals where the underlying logs match nothing — which for
   * door-knocking spend is most of them. `or vector(0)` is what makes the
   * pipeline emit an explicit zero instead of an empty result, so dropping it
   * would not break the budget tiers, it would break the thing watching them,
   * and it would do so silently.
   */
  it('makes every recording rule write in every interval', () => {
    for (const rule of RECORDING_RULES) {
      expect(rule.expr, rule.slug).toContain('or vector(0)')
    }
  })

  /**
   * The constraint that killed the route recording rules, written down as a
   * test so the next person meets it in CI rather than in a silent outage.
   *
   * Grafana's recording-rule writer requires a wide frame. A Loki query that
   * returns one series per label set is `timeseries-multi` and is rejected with
   * `unsupported time series type timeseries-multi` — reported nowhere the rule
   * itself can be seen to be unhealthy. A bare `sum(...)` collapses to a single
   * unlabelled series, which the writer accepts; `sum by (...)` does not.
   *
   * So a recording rule here may not group. Anything that needs a dimension
   * preserved reads Loki directly, the way the route alerts do.
   */
  it('never groups a recording rule, which the writer cannot accept', () => {
    for (const rule of RECORDING_RULES) {
      expect(rule.expr, rule.slug).not.toMatch(/\bby\s*\(/)
      expect(rule.expr, rule.slug).not.toMatch(/\bwithout\s*\(/)
    }
  })
})

// The two structural properties of a recording rule, asserted over every one
// we provision rather than only over the route pair that used to live in route-alerts.test.
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

describe('loki query budget', () => {
  const alerts = GLOBAL_ALERTS.filter((alert) =>
    alert.slug.startsWith('loki-query-budget-'),
  )

  it('registers both tiers', () => {
    expect(alerts.map((alert) => alert.slug).sort()).toEqual([
      'loki-query-budget-critical',
      'loki-query-budget-half',
    ])
  })

  // These three guard one regression. Shipped on 2026-09-29 averaging over an
  // hour and holding for 30m, both rules flapped: the ratio crossed 0.8
  // several times an hour, and since Alertmanager re-notifies a still-firing
  // alert only every 2d, every page came from a resolve/re-fire cycle rather
  // than from the overage. The allowance is billed monthly, so a crossing that
  // settles inside a couple of hours was never going to reach an invoice.
  it.each(alerts)('$slug averages over hours, not minutes', (alert) => {
    expect(widestRangeSeconds(alert.expr)).toBeGreaterThanOrEqual(6 * 3600)
  })

  it.each(alerts)('$slug must stay over for hours to page', (alert) => {
    const [, amount, unit] = /^(\d+)([smhd])$/.exec(alert.for) ?? []
    expect(toSeconds(amount ?? '', unit ?? '')).toBeGreaterThanOrEqual(2 * 3600)
  })

  it.each(alerts)('$slug fetches the whole window it averages', (alert) => {
    const fetched = alert.timeRangeSeconds ?? DEFAULT_FETCH_SECONDS
    expect(fetched).toBeGreaterThanOrEqual(widestRangeSeconds(alert.expr))
  })
})
