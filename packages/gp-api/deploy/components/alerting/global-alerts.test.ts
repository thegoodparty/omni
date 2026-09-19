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
    expect(alert!.expr).toContain('/v1/public-person-profiles(/.*)?$')
  })

  // The worst answer a route can give is none, and it is the one a status
  // range cannot see: a request the gateway kills mid-flight completes with a
  // null status, which Loki's json parser drops, so `>= 500` misses it. The
  // generated rules learned this from two door-knocking timeouts that went
  // unseen in August (see noStatusFilter in controller-alerts.ts), and a
  // hand-written rule gets no benefit from that unless it says so itself.
  it('counts a request that was killed before it could answer', () => {
    expect(alert!.expr).toContain(
      '( response_statusCode >= 500 ) or ( response_statusCode = "" )',
    )
  })

  // And in the denominator too. Failures that are not also traffic push the
  // ratio above 100% during a pure timeout wave, and leave the volume floor
  // guarding a smaller population than the ratio it is supposed to qualify.
  // Three occurrences: once as a failure, and once in each of the two places
  // the non-404 population is counted — the ratio, and the floor.
  it('counts that request as traffic as well as as a failure', () => {
    expect(alert!.expr).toContain(
      '( response_statusCode != 404 ) or ( response_statusCode = "" )',
    )

    const occurrences = alert!.expr.match(/response_statusCode = ""/g) ?? []
    expect(occurrences.length).toBe(3)
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
 */
const rereadFactor = (alert: Alert) =>
  (alert.timeRangeSeconds ?? DEFAULT_FETCH_SECONDS) /
  (alert.evaluationIntervalSeconds ?? DEFAULT_EVALUATION_SECONDS)

// The two 6h rules sat at 360 on the 60s default and were between them the
// largest single line in the Loki query bill. This ceiling is what stops a
// wide fetch window being paired with a fast interval again; it is not a
// target, and a rule near it is still worth a second look.
const MAX_REREAD_FACTOR = 100

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
