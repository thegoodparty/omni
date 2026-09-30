import { describe, expect, it } from 'vitest'
import {
  CONTROLLER_NAMES,
  ControllerName,
  ROUTE_MAP,
} from '../../../src/generated/route-types'
import {
  ALERT_OWNERSHIP,
  CONTROLLERS_WITHOUT_ROUTE_ALERTS,
  GLOBAL_ALERTS,
  SERVER_ERRORS_ONLY,
} from '../alerts'
import { alertTimeRange } from '../grafana'
import { buildAlertDescription } from './alert-notification'
import {
  ROUTE_EVALUATION_SECONDS,
  routeAlertGroups,
  routeEndpointPattern,
  routeErrorAlerts,
} from './route-alerts'

const GROUPS = routeAlertGroups()
const ALERTS = routeErrorAlerts()

const OWNED = new Set(Object.values(ALERT_OWNERSHIP).flat())

/**
 * The one group a controller belongs to.
 *
 * Asserting there is exactly one here rather than indexing keeps
 * `noUncheckedIndexedAccess` satisfied and re-checks the
 * one-group-per-controller invariant at every call site.
 */
const groupFor = (controller: ControllerName) => {
  const [group, ...rest] = GROUPS.filter((one) =>
    one.controllers.includes(controller),
  )
  if (!group || rest.length > 0) {
    throw new Error(`expected exactly one group for ${controller}`)
  }
  return group
}

/** The alert generated from one group, found by the slug they share. */
const alertFor = (slug: string) => {
  const alert = ALERTS.find((one) => one.slug === slug)
  if (!alert) {
    throw new Error(`no alert is generated for group ${slug}`)
  }
  return alert
}

/**
 * A controller that still gets the wide 4xx filter, derived rather than named.
 *
 * Every test about the 4xx vocabulary needs one, and naming a favourite is how
 * these tests rot: they all said `contacts` until `contacts` joined
 * SERVER_ERRORS_ONLY, at which point the assertions inverted and read as a bug
 * in the filter rather than a stale fixture. Deriving it means adding the next
 * controller to the list moves these tests to another subject instead of
 * breaking them.
 */
const outsideServerErrorsOnly = (): ControllerName => {
  const name = CONTROLLER_NAMES.find(
    (candidate) =>
      !SERVER_ERRORS_ONLY.includes(candidate) &&
      OWNED.has(candidate) &&
      ROUTE_MAP[candidate].length > 0,
  )
  if (!name) {
    // Not a skip: with every controller on the list there is no 4xx path left
    // to assert, and these tests would pass by vacuously checking nothing.
    throw new Error(
      'every routed controller is in SERVER_ERRORS_ONLY, so nothing pages on 4xx',
    )
  }
  return name
}

/** The alert covering a controller that is outside SERVER_ERRORS_ONLY. */
const anyErrorAlert = () => alertFor(groupFor(outsideServerErrorsOnly()).slug)

/** The alert covering a controller that is inside SERVER_ERRORS_ONLY. */
const serverErrorAlert = () => {
  const name = SERVER_ERRORS_ONLY.find(
    (candidate) => OWNED.has(candidate) && ROUTE_MAP[candidate].length > 0,
  )
  if (!name) {
    throw new Error('no owned, routed controller is in SERVER_ERRORS_ONLY')
  }
  return alertFor(groupFor(name).slug)
}

// Mirrors grafana.ts's `alert.timeRangeSeconds ?? 600` — the window the
// alerting engine actually fetches when an alert does not pin its own.
const DEFAULT_FETCH_SECONDS = 600

// `max_query_series` on the Loki tenant. One rule now returns one series per
// route across every controller it covers, so the widest group has to stay
// under it, and so therefore does the whole route map.
const MAX_QUERY_SERIES = 500

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

const toSeconds = (amount: string, unit: string) =>
  Number(amount) * (UNIT_SECONDS[unit.charAt(0)] ?? 0)

/** Seconds covered by the range vector in a LogQL expression. */
const rangeSeconds = (expr: string) => {
  const match = /\[(\d+)([smhd])\]/.exec(expr)
  const [, amount, unit] = match ?? []
  if (!amount || !unit) {
    throw new Error(`no range vector in expr: ${expr}`)
  }
  return toSeconds(amount, unit)
}

/** The window the notification tells the reader it looked at, in seconds. */
const promisedWindow = (message: string) => {
  const match =
    /in the (\d+) (seconds|minutes|hours) ending (\d+) (seconds|minutes|hours) before/.exec(
      message,
    )
  const [, amount, unit, offset, offsetUnit] = match ?? []
  if (!amount || !unit || !offset || !offsetUnit) {
    throw new Error(`message does not state a numeric window: ${message}`)
  }
  return {
    width: toSeconds(amount, unit),
    offset: toSeconds(offset, offsetUnit),
  }
}

/**
 * The endpoint alternation out of a LogQL label matcher.
 *
 * Read out of a backtick raw string, which is what carries the pattern into
 * the expression. Unlike the PromQL double-quoted string this replaced, LogQL
 * does not unescape it, so what is read here is exactly what Loki's regex
 * engine compiles, and `new RegExp` on it tests the real thing.
 */
const endpointPattern = (expr: string) => {
  const [, pattern] = /request_endpoint =~ `([^`]*)`/.exec(expr) ?? []
  if (pattern === undefined) {
    throw new Error(`no endpoint matcher in expr: ${expr}`)
  }
  return pattern
}

// The rules that replaced 75 per-controller ones. Only two things ever vary
// between those: who is notified, and which status filter applies. Both are
// properties of the rule rather than of the series it returns, which is why
// controllers that agree on both can share a rule without either changing
// meaning.
describe('route alert groups', () => {
  // THE COUNT IS THE COST, which is the only reason it is pinned rather than
  // derived. A Loki rule's daily read volume is its fetch window divided by
  // its evaluation interval, and every one of these selects the whole gp-api
  // stream, so once the window is at the gapless floor the only lever left is
  // how many rules there are. 75 of them at that floor was 75x ingest: 2,690
  // GB/day measured on 2026-09-28, then Grafana Cloud 429s, and then, because
  // `exec_err_state` is `Alerting`, all 154 rules firing at once while
  // production was healthy. Five is five. A change that adds a sixth is a
  // change to the bill, and should have to say so here.
  it('collapses every owned controller into five rules', () => {
    expect(GROUPS).toHaveLength(5)
    expect(ALERTS).toHaveLength(GROUPS.length)
  })

  // The slug is the alert's identity in Grafana and in the routing snapshot.
  // Two groups sharing one would provision a single rule under whichever
  // definition Pulumi applied last, and the other group's controllers would go
  // silent with nothing anywhere saying so.
  it('gives every group a slug of its own', () => {
    const slugs = GROUPS.map((group) => group.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  // The invariant the whole collapse rests on: bucketing is only safe if it
  // partitions. A controller in two groups pages twice for one error; a
  // controller in none is silent, which is the failure mode no alert reports.
  it('covers every owned, routed controller exactly once', () => {
    for (const controller of CONTROLLER_NAMES) {
      if (!OWNED.has(controller)) continue
      if (ROUTE_MAP[controller].length === 0) continue

      const covering = GROUPS.filter((group) =>
        group.controllers.includes(controller),
      )
      expect(covering.length, controller).toBe(1)
    }
  })

  // A controller with no owner is not in a group at all, rather than
  // provisioned paused. That makes the opt-out list the only way a routed
  // controller can be unwatched, and this is what keeps the list honest: an
  // opted-out route appearing in someone else's endpoint alternation would
  // page a team for a route they deliberately do not watch.
  it('never covers a controller that opted out', () => {
    const optedOut = new Set(CONTROLLERS_WITHOUT_ROUTE_ALERTS)

    for (const group of GROUPS) {
      for (const controller of group.controllers) {
        expect(optedOut.has(controller), `${controller} in ${group.slug}`).toBe(
          false,
        )
      }
    }
  })

  // A fifth of these controllers are shared, and `owners` only became a list so
  // that could be said out loud. If a later edit collapses them to one group,
  // the alert still fires and still looks owned — the other team just silently
  // stops being told, which is the same class of bug as the `find` this
  // replaced.
  it('still tags both groups where a controller is shared', () => {
    const shared = GROUPS.filter((group) => group.owners.length > 1)

    expect(
      shared.length,
      'no group notifies more than one team, so either the shared surfaces lost an owner or owners stopped carrying lists',
    ).toBeGreaterThan(0)

    for (const group of GROUPS) {
      expect(group.owners.length, `${group.slug} has no owner`).toBeGreaterThan(
        0,
      )
      expect(new Set(group.owners).size, `${group.slug} repeats a team`).toBe(
        group.owners.length,
      )
      expect([alertFor(group.slug).notify ?? []].flat()).toEqual(group.owners)
    }
  })

  // `routeAlertGroups` throws on an owner set OWNER_NAMING does not register,
  // and that is deliberate rather than defensive: the slug is the alert's
  // identity in Grafana, so deriving one from the team names would let a
  // rename silently retire every alert under it and create a new one with no
  // history. Both Slack groups are registered in every combination, so the
  // throw is unreachable from the real map and has to be provoked. Adding a
  // third product to ALERT_OWNERSHIP is the edit it exists to catch, and it
  // has to fail the deploy rather than quietly stop provisioning rules.
  it('refuses an owner set that has no registered slug', () => {
    const ownership: Record<string, ControllerName[]> = ALERT_OWNERSHIP
    ownership['platform-bugs'] = [outsideServerErrorsOnly()]

    try {
      expect(() => routeAlertGroups()).toThrow(/OWNER_NAMING/)
    } finally {
      delete ownership['platform-bugs']
    }
  })
})

describe('the grouped route alerts', () => {
  // The whole point of the 2026-09-28 rollback. The two recording rules that
  // sat between these alerts and Loki never wrote a datapoint, because
  // Grafana's writer rejects the `timeseries-multi` a Loki instant query
  // returns, and they reported `health: ok` throughout. So 168 alert rules
  // read a metric nobody wrote and, with `noDataState: OK`, none of them could
  // fire at all. A PromQL metric selector here is that outage; a stream
  // selector is what makes a broken query raise an execution error instead of
  // looking like silence.
  it('reads the Loki stream rather than a recorded metric', () => {
    for (const alert of ALERTS) {
      expect(alert.type, alert.slug).toBe('log')
      expect(alert.expr, alert.slug).toContain('service_name="gp-api"')
      expect(alert.expr, alert.slug).not.toContain('gp_api:')
      expect(alert.expr, alert.slug).not.toMatch(/sum_over_time\(/)
    }
  })

  // THE COST PROPERTY, AS A TEST. A rule's Loki bill is its fetch window
  // divided by its evaluation interval — the number of times a day it re-reads
  // the same bytes. At 1:1 each log line is read exactly once, which is the
  // floor for a rule that cannot afford to miss an error and is the entire
  // point of this collapse. A window wider than the interval silently
  // re-reads, which is the defect that produced 2,690 GB/day and the
  // 2026-09-28 429s, so it fails the suite rather than living in a comment.
  it('reads each log line exactly once', () => {
    for (const alert of ALERTS) {
      const window = alert.timeRangeSeconds
      const interval = alert.evaluationIntervalSeconds

      expect(window, alert.slug).toBeGreaterThan(0)
      expect(interval, alert.slug).toBe(window)
    }
  })

  // Grafana evaluates a rule group as a unit, so the group's interval is the
  // one that actually runs, and grafana.ts provisions every route rule into
  // one group on ROUTE_EVALUATION_SECONDS. An alert claiming another interval
  // would make the ratio asserted above fiction.
  it('evaluates on the interval its rule group is provisioned for', () => {
    for (const alert of ALERTS) {
      expect(alert.evaluationIntervalSeconds, alert.slug).toBe(
        ROUTE_EVALUATION_SECONDS,
      )
    }
  })

  // THE LATENCY PROPERTY, AS A TEST, because it is the one a cost change would
  // quietly take back. Every rule judges one minute, so every rule reaches a
  // page within 90 seconds of the error: the 60-second window plus the 30
  // seconds it trails real time by.
  it('judges a 60-second window that ends 30 seconds before evaluation', () => {
    for (const alert of ALERTS) {
      const { from, to } = alertTimeRange(alert)

      expect(from - to, alert.slug).toBe(60)
      expect(to, alert.slug).toBe(30)
      expect(rangeSeconds(alert.expr), alert.slug).toBe(from - to)
    }
  })

  // Back to back is what makes the shift free: each evaluation's window starts
  // exactly where the previous one ended, so no line is read by two
  // evaluations and none falls between two.
  it('tiles consecutive evaluations with no gap and no overlap', () => {
    for (const alert of ALERTS) {
      const { from, to } = alertTimeRange(alert)
      const interval = alert.evaluationIntervalSeconds ?? 60
      const window = (evaluatedAt: number) => ({
        start: evaluatedAt - from,
        end: evaluatedAt - to,
      })

      for (const t of [0, 60, 600, 86_340]) {
        expect(window(t + interval).start, alert.slug).toBe(window(t).end)
      }
    }
  })

  // THE REASON FOR THE SHIFT, AS A TEST. A line stamped `ts` reaches Loki
  // `lag` seconds later. An evaluation at `t` counts it only if `ts` is inside
  // its window AND the line has arrived by `t`. Sweeping every second of an
  // hour at a 5-second lag (4.6s was measured on 2026-09-29), the shifted
  // window counts every line exactly once, while the same rule ending at `now`
  // loses every line stamped in the last 5 seconds of a window — the premise,
  // proved rather than asserted.
  it('counts every line that reaches Loki within 30 seconds, and the old window did not', () => {
    const LAG = 5
    const timesCounted = (
      range: { from: number; to: number },
      interval: number,
      ts: number,
      lag: number,
    ) => {
      let count = 0
      for (let t = 0; t <= 3_600 + range.from + interval; t += interval) {
        const inWindow = ts >= t - range.from && ts < t - range.to
        if (inWindow && ts + lag <= t) count += 1
      }
      return count
    }

    for (const alert of ALERTS) {
      const range = alertTimeRange(alert)
      const interval = alert.evaluationIntervalSeconds ?? 60
      const unshifted = { from: range.from - range.to, to: 0 }

      for (let ts = 60; ts < 3_600; ts += 1) {
        expect(
          timesCounted(range, interval, ts, LAG),
          `${alert.slug} @${ts}`,
        ).toBe(1)
        expect(
          timesCounted(range, interval, ts, range.to),
          `${alert.slug} @${ts}`,
        ).toBe(1)
      }

      const lostBefore = []
      for (let ts = 60; ts < 3_600; ts += 1) {
        if (timesCounted(unshifted, interval, ts, LAG) === 0)
          lostBefore.push(ts)
      }
      expect(lostBefore.length, alert.slug).toBeGreaterThan(0)
      expect(lostBefore.every((ts) => ts % interval >= interval - LAG)).toBe(
        true,
      )
    }
  })

  // The message has to warn the reader that the page trails the error, or a
  // responder comparing the page time against the logs will distrust both.
  it('says the window trails real time and what that costs', () => {
    for (const alert of ALERTS) {
      expect(alert.message, alert.slug).toContain(
        'later than the error would otherwise allow',
      )
    }
  })

  // Zero, and the reason is stronger on a minute window than it was on ten.
  // `for` counts whole evaluations, so '1m' means "breach twice in a row" —
  // and the second evaluation reads the NEXT minute. Every error event measured
  // on these routes arrived inside a single minute (5 in one, 47 in one, 7 in
  // eight seconds), with the following minute clean, so any `for` above zero
  // would silence the exact bursts these rules exist to catch.
  it('waits no extra evaluation before firing', () => {
    for (const alert of ALERTS) {
      expect(alert.for, alert.slug).toBe('0m')
    }
  })

  it('splits the single read into one series per route', () => {
    for (const alert of ALERTS) {
      expect(alert.expr, alert.slug).toContain('sum by (request_endpoint)')
    }
  })

  // `mcp` generated no rule at all until 2026-09-17. Its only handler is
  // `@All()`, which generate-route-types.ts did not recognise, so the
  // controller reached CONTROLLER_NAMES with an empty ROUTE_MAP and the loop
  // below it had nothing to iterate — while POST /v1/mcp served 24,736 requests
  // in 30 days and GET another 69,016.
  //
  // Both live methods are named rather than just asserting a rule exists: the
  // generator expands `@All()` across every method fastify registers, and a
  // regression to one of them would still produce a rule that looks right and
  // watches half the endpoint.
  it('watches every method the mcp @All() handler answers', () => {
    const group = groupFor('mcp')
    const { expr } = alertFor(group.slug)

    expect(expr).toContain('GET /v1/mcp')
    expect(expr).toContain('POST /v1/mcp')
    expect(group.owners).toEqual(['serve-bugs', 'win-bugs'])
  })

  // The rule reads the whole gp-api stream, so the endpoint pattern is the
  // only thing keeping a group to its own controllers. Without it a `contacts`
  // page would fire for a `polls` route, and every opted-out controller's
  // routes would page through whichever group happened to read them first.
  it('matches every route in its own group', () => {
    for (const group of GROUPS) {
      const pattern = new RegExp(endpointPattern(alertFor(group.slug).expr))
      for (const endpoint of group.endpoints) {
        expect(pattern.test(endpoint), `${group.slug}: ${endpoint}`).toBe(true)
      }
    }
  })

  it('matches no route from outside its own group', () => {
    const everyEndpoint = Object.values(ROUTE_MAP)
      .flat()
      .map(({ endpoint }) => endpoint)

    for (const group of GROUPS) {
      const pattern = new RegExp(endpointPattern(alertFor(group.slug).expr))
      const own = new Set(group.endpoints)

      for (const endpoint of everyEndpoint) {
        if (own.has(endpoint)) continue
        expect(pattern.test(endpoint), `${group.slug}: ${endpoint}`).toBe(false)
      }
    }
  })

  // Loki anchors a label-matcher regex on its own, but the alternation is
  // written anchored anyway: unanchored, `GET /v1/contacts` would also swallow
  // `GET /v1/contacts/:id`, silently merging two routes into one alert
  // instance and losing the one that fired second.
  it('anchors the endpoint alternation', () => {
    for (const group of GROUPS) {
      const pattern = endpointPattern(alertFor(group.slug).expr)
      expect(pattern.startsWith('^(?:'), group.slug).toBe(true)
      expect(pattern.endsWith(')$'), group.slug).toBe(true)

      const compiled = new RegExp(pattern)
      for (const endpoint of group.endpoints) {
        expect(compiled.test(`${endpoint}/zzz`), endpoint).toBe(false)
      }
    }
  })

  // The pattern goes into a LogQL backtick raw string, so a backtick reaching
  // it would terminate that string early and produce a rule that either fails
  // to parse at provision time or matches the wrong thing.
  it('builds a pattern no endpoint can break out of', () => {
    for (const { endpoint } of Object.values(ROUTE_MAP).flat()) {
      expect(endpoint).not.toContain('`')
    }

    for (const group of GROUPS) {
      expect(routeEndpointPattern(group.endpoints), group.slug).not.toContain(
        '`',
      )
    }
  })

  // THE SUBTLEST THING IN THIS FILE, and the only regression here that fails
  // nowhere else: the escaping has to reach Loki's regex engine as written.
  // The backtick raw string carries it verbatim, since LogQL does not unescape
  // one, so exactly one backslash is correct here. The PromQL double-quoted
  // spelling this replaced needed two, because Go unescaping ate one before
  // the matcher compiled. Doubling it now would match a literal backslash
  // instead of the dot and the rule would silently watch nothing. No real
  // endpoint carries a metacharacter today, so this is pinned against a
  // synthetic one.
  it('escapes a regex metacharacter exactly once', () => {
    const pattern = routeEndpointPattern(['GET /v1/a.b'])

    expect(pattern).toBe('^(?:GET /v1/a\\.b)$')

    const compiled = new RegExp(pattern)
    expect(compiled.test('GET /v1/a.b')).toBe(true)
    expect(compiled.test('GET /v1/aXb')).toBe(false)
  })

  // Grafana renders annotations per alert instance, so this is what turns one
  // rule back into a page that names the route that broke. Without it the
  // notification says only which team is unhappy, which is a strictly worse
  // page than the per-controller rules it replaces.
  it('names the offending route in the notification', () => {
    for (const alert of ALERTS) {
      expect(alert.summaryDetail, alert.slug).toContain(
        '$labels.request_endpoint',
      )
      expect(alert.message, alert.slug).toContain('$labels.request_endpoint')
    }
  })

  // The rule counts "Request completed" lines, which carry the status but
  // not the cause. The cause is on the exception lines for the same request,
  // one query away — and on 2026-09-22 a POST /v1/outreach/sms/draft page
  // took a Loki session to learn it was a schema-length reject, not the
  // gateway timeout the message warns about. The link lands the reader on
  // those lines for the route that actually fired.
  it('links the reader to the error lines for the route that fired', () => {
    for (const alert of ALERTS) {
      expect(alert.message, alert.slug).toContain(
        'https://goodparty.grafana.net/explore',
      )
      expect(alert.message, alert.slug).toContain(
        '{{ $labels.request_endpoint | urlquery }}',
      )
      expect(alert.message, alert.slug).toContain('exception_type')

      const description = buildAlertDescription(alert, 'prod')
      expect(description, alert.slug).toContain('deployment_environment_name')
      expect(description, alert.slug).toContain('prod')
      expect(description, alert.slug).not.toContain('$ENV')
    }
  })

  it('keeps every group under the tenant series cap', () => {
    for (const group of GROUPS) {
      expect(group.endpoints.length, group.slug).toBeLessThan(MAX_QUERY_SERIES)
    }

    // The fan-out moved with the read. Six rules now cover every owned route
    // between them, so the bound that matters is the whole route map rather
    // than any one controller's slice of it.
    expect(Object.values(ROUTE_MAP).flat().length).toBeLessThan(
      MAX_QUERY_SERIES,
    )
  })

  // The regression: the vector was written `[1h]` while these alerts take the
  // default 600s fetch, which silently caps it. The rule only ever saw ten
  // minutes of logs, so the extra fifty minutes of vector bought nothing.
  it('keeps the range vector inside the window the engine fetches', () => {
    for (const alert of ALERTS) {
      const fetched = alert.timeRangeSeconds ?? DEFAULT_FETCH_SECONDS
      expect(rangeSeconds(alert.expr), alert.slug).toBeLessThanOrEqual(fetched)
    }
  })

  // The other half of that regression, and the one a responder pays for: the
  // message said "in the last hour", so triage swept an hour of logs for
  // errors that could only have come from the last ten minutes.
  it('promises the reader the window it actually queried', () => {
    for (const alert of ALERTS) {
      const { from, to } = alertTimeRange(alert)
      expect(promisedWindow(alert.message), alert.slug).toEqual({
        width: rangeSeconds(alert.expr),
        offset: to,
      })
      expect(from - to, alert.slug).toBe(rangeSeconds(alert.expr))
    }
  })

  // THE INNER VECTOR'S WIDTH, AS A TEST. `count_over_time` counts one series
  // per distinct label set, and on these lines the label set is structured
  // metadata — which carries `requestId`, `trace_id`, `span_id` and
  // `request_url`, all unique per request. Left alone, the vector being
  // counted is about one series per log line, sized by traffic rather than by
  // anything we control, and a `| json` on top of that doubles it (Grafana
  // Cloud already promoted those fields, so the parser only adds
  // `*_extracted` copies of labels the filter was reading anyway).
  //
  // `| keep` after the filter is what bounds it: the counted vector then
  // carries exactly the label the rule groups by, so its width is the number
  // of distinct endpoints — bounded by ROUTE_MAP rather than by traffic.
  // Asserted as an equality with the `sum by` grouping rather than as
  // "contains keep", because the two have to agree: a `keep` that dropped the
  // grouping label would collapse every route into one unlabelled series and
  // the notification, which reads `$labels.request_endpoint`, would render an
  // empty route name on every page.
  it('counts a vector carrying only the label it groups by', () => {
    for (const alert of ALERTS) {
      const [, grouped] = /^sum by \(([^)]*)\)/.exec(alert.expr) ?? []
      const [, kept] = /\|\s*keep\s+([^[|]+)/.exec(alert.expr) ?? []

      const labels = (list: string | undefined) =>
        (list ?? '')
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean)
          .sort()

      expect(labels(kept), alert.slug).toEqual(labels(grouped))
      expect(labels(grouped).length, alert.slug).toBeGreaterThan(0)
    }
  })

  // The specific edit that reintroduces the above. A parser with no field list
  // extracts every key in the line into the vector's identity, so it is never
  // what these rules want — and here it would not even be doing the extraction
  // it looks like it is doing, since the fields it names arrive as structured
  // metadata and Loki renames the parser's output to `*_extracted`. A field
  // list is fine; a bare parser is the regression.
  it('extracts no per-request field into the counted vector', () => {
    for (const alert of ALERTS) {
      expect(alert.expr, alert.slug).not.toMatch(
        /\|\s*(json|logfmt|pattern|regexp)\s*(\||\[)/,
      )
    }
  })

  // Every rule reads the one stream, and every one carries `$ENV` — grafana.ts
  // substitutes the environment into `expr` on provision, and a rule that
  // hardcoded one would have dev and prod judging the same logs.
  it('reads one stream, in the environment grafana.ts substitutes', () => {
    for (const alert of ALERTS) {
      expect(alert.expr, alert.slug).toContain(
        '{service_name="gp-api", deployment_environment_name="$ENV"}',
      )
      expect(alert.expr, alert.slug).toContain('|= "Request completed"')
    }
  })
})

// The status vocabulary. It lives on the five expressions now rather than on
// two recording rules, so every assertion about WHICH statuses count reads the
// filter and the prose that describes it off the same object again.
describe('which statuses count as an error', () => {
  // SERVER_ERRORS_ONLY: door knocking answers an over-budget knock with 429
  // and an ineligible district with 400, so paging on 4xx would page on the
  // feature working. Now that 400 is excluded everywhere, 429 is the part
  // still doing the work here — the 400s would be dropped by the default
  // filter too.
  //
  // Derived over the whole list rather than asserted on door-knocking, so the
  // list is what decides for any membership rather than one controller being
  // special-cased somewhere.
  it('pages on 5xx only for every controller in SERVER_ERRORS_ONLY', () => {
    for (const name of SERVER_ERRORS_ONLY) {
      if (!OWNED.has(name) || ROUTE_MAP[name].length === 0) continue

      const group = groupFor(name)
      expect(group.serverErrorsOnly, name).toBe(true)

      const { expr } = alertFor(group.slug)
      expect(expr, name).toContain('response_statusCode >= 500')
      expect(expr, name).not.toContain('response_statusCode >= 400')
    }
  })

  // The per-controller filter has to survive the collapse: a controller outside
  // SERVER_ERRORS_ONLY must still get the wider filter rather than inherit its
  // neighbour's. The subject is DERIVED rather than named, because naming one
  // is how this test rots — it said `contacts` until `contacts` was added to
  // the list, at which point the assertion inverted and the failure read as a
  // bug in the filter rather than a stale fixture.
  it('pages on 4xx too for a controller outside SERVER_ERRORS_ONLY', () => {
    const controller = outsideServerErrorsOnly()
    expect(groupFor(controller).serverErrorsOnly, controller).toBe(false)

    const { expr } = anyErrorAlert()
    expect(expr).toContain('response_statusCode >= 400')
    expect(expr).not.toContain('response_statusCode >= 500')
  })

  // The codes are written out rather than imported from the source list on
  // purpose: importing would assert the constant equals itself, and this test
  // exists to fail loudly when someone edits that list. 400 is the one worth
  // naming — it was counted until this list gained it, and a single validation
  // refusal or Pro gate hit was enough to page, which is what taught us a 400
  // is never evidence of a fault on its own.
  it('excludes the designed client-error vocabulary, 400 included', () => {
    const { expr } = anyErrorAlert()

    for (const code of [400, 401, 403, 404, 409, 498]) {
      expect(expr).toContain(`response_statusCode != ${code}`)
    }
  })

  // The prose used to restate the exclusions as a hardcoded string, so it was
  // one edit away from telling whoever it paged that a status it had just
  // stopped counting was still in scope. Both sides now read one constant;
  // this pins them together without naming the codes a third time.
  it('tells the reader the same exclusions the filter applies', () => {
    const alert = anyErrorAlert()
    const filtered = [
      ...alert.expr.matchAll(/response_statusCode != (\d+)/g),
    ].map(([, code]) => code)
    const [, prose] =
      /status ≥ 400 excluding ([\d/]+)/.exec(alert.message) ?? []

    expect(filtered.length).toBeGreaterThan(0)
    expect(prose?.split('/')).toEqual(filtered)
  })

  // The blind spot this closes: a request the gateway kills mid-flight logs
  // `statusCode: null`, which is neither 4xx nor 5xx, so no status-range
  // filter matched it. Two door-knocking pack timeouts in seven days paged
  // nobody. Loki drops a null field and reads a missing label as empty, so
  // the empty-string comparison is what catches it either way.
  it('pages when a request completes with no status at all', () => {
    for (const alert of ALERTS) {
      expect(alert.expr, alert.slug).toContain('response_statusCode = ""')
      expect(alert.message, alert.slug).toContain('null')
    }
  })

  // "We never answered" covers two things, and only one is a fault: the gateway
  // gave up on us, or the caller did. The second is not actionable and is four
  // fifths of the volume — 2,345 of 2,348 null statuses in dev over the 30 days
  // to 2026-09-17 ran under 30s, which is the E2E suite aborting requests as it
  // navigates, logged at `info` with `bytes: null`. Without a floor this clause
  // pages on users closing tabs, and across every controller that is the kind
  // of alert someone mutes.
  it('ignores a null status the caller caused by hanging up', () => {
    for (const alert of ALERTS) {
      expect(alert.expr, alert.slug).toMatch(/responseTimeMs > \d+/)
    }
  })

  // The floor has to sit between the two populations it separates: above any
  // real handler, and below the gateway's ~120s idle timeout, or it discards
  // the timeouts the clause exists to catch along with the aborts. It is also
  // load-bearing to the millisecond on `mcp`, whose no-status completions
  // cluster at 30001-30007ms. That is the calling client's own deadline
  // expiring rather than infrastructure severing the connection, so raising
  // the floor at all silences that controller's entire measured error signal.
  it('puts the floor under the gateway timeout it has to catch', () => {
    for (const alert of ALERTS) {
      const floor = Number(/responseTimeMs > (\d+)/.exec(alert.expr)?.[1])

      expect(floor, alert.slug).toBeGreaterThan(5_000)
      expect(floor, alert.slug).toBeLessThan(120_000)
    }
  })

  // The message tells whoever is paged what to look for, so it has to state
  // the floor and name the field they will read it off. Reading "the request
  // was killed in flight" and then finding nothing under 30s in the logs is
  // how someone concludes the alert is broken.
  it('says that short no-status requests are excluded', () => {
    for (const alert of ALERTS) {
      expect(alert.message, alert.slug).toMatch(/30 seconds/)
      expect(alert.message, alert.slug).toContain('responseTimeMs')
    }
  })

  // It has to catch the timeout without dragging the 4xx vocabulary back in —
  // a null status is the absence of one, so it can't overlap with 429 or 400.
  // Asserted on a server-error rule only, which is the same scope it always
  // had: the wide rule names 4xx codes deliberately, to exclude them.
  it('admits no 4xx alongside the null-status clause', () => {
    expect(serverErrorAlert().expr).not.toMatch(
      /response_statusCode\s*[<>=!]+\s*4\d\d/,
    )
  })

  // `A and B or C` is one precedence misread away from paging on every 401.
  it('parenthesizes the status clauses', () => {
    for (const group of GROUPS) {
      const { expr } = alertFor(group.slug)

      if (group.serverErrorsOnly) {
        expect(expr, group.slug).toContain(
          '( response_statusCode >= 500 ) or (',
        )
      } else {
        expect(expr, group.slug).toContain('( response_statusCode >= 400')
      }
      expect(expr, group.slug).toContain(') or (')
    }
  })
})

// The gap these guard is not a wrong alert but an absent one, which is the
// failure mode no alert can report. A controller nobody lists is simply not in
// a group, so it is silently opted out. CONTROLLERS_WITHOUT_ROUTE_ALERTS makes
// that a declaration rather than an oversight, and these are what make the
// declaration mandatory.
describe('every controller is accounted for', () => {
  const unmonitored = new Set(CONTROLLERS_WITHOUT_ROUTE_ALERTS)

  // The one that matters: a controller added tomorrow lands in neither list and
  // fails here, so the author picks an owner or writes down that they did not
  // want one. Without this, a new public endpoint inherits silence by default
  // and nothing says so — which is how public-person-profiles/voter-density
  // served 1,498,324 consecutive 500s over four days in August 2026 without
  // paging anyone.
  it('requires a new controller to choose an owner or opt out', () => {
    const unaccounted = CONTROLLER_NAMES.filter(
      (controller) => !OWNED.has(controller) && !unmonitored.has(controller),
    )

    expect(
      unaccounted,
      'these controllers are in neither ALERT_OWNERSHIP nor CONTROLLERS_WITHOUT_ROUTE_ALERTS, so they have no route alerting and nothing records that',
    ).toEqual([])
  })

  // Listing a controller in both reads as "owned" here and "deliberately
  // silent" there, and the code would honour the first while a reviewer
  // believes the second.
  it('never claims a controller is both owned and opted out', () => {
    const both = CONTROLLERS_WITHOUT_ROUTE_ALERTS.filter((controller) =>
      OWNED.has(controller),
    )

    expect(both).toEqual([])
  })

  // Keeps the list honest in the other direction: an entry that no longer names
  // a real controller is a claim about nothing, and would quietly absorb a
  // future controller that reused the name. `ControllerName` catches a typo at
  // compile time, but not an entry left behind when a controller is deleted.
  it('names only controllers that exist', () => {
    const stale = CONTROLLERS_WITHOUT_ROUTE_ALERTS.filter(
      (controller) => !CONTROLLER_NAMES.includes(controller),
    )

    expect(stale).toEqual([])
  })

  // The two public controllers and the hand-written rule each one carries in
  // addition to its generated route alert.
  //
  // These were opted OUT until 2026-09, on the argument that a threshold-0 rule
  // would fire permanently on their traffic. Measuring said otherwise — 2 hours
  // out of 168 contained a qualifying error — so they now have both an owner
  // and a ratio rule, and the pairing below is about keeping the second half.
  const BESPOKE_COVERAGE: ReadonlyArray<readonly [ControllerName, string]> = [
    ['public-campaigns', 'public-campaigns-lookup-error-ratio'],
    ['public-person-profiles', 'public-person-profiles-error-ratio'],
  ]

  // Both halves do different jobs, and the reason for keeping the ratio rule is
  // the weaker of the two claims, so it is the one that needs a test: the
  // generated rule is what would survive deleting it, which makes the deletion
  // look free. It is not — the ratio rule is what still works if these routes'
  // error volume returns to where it was when the generated rule was judged
  // unusable, and it is where the known causes live.
  it('keeps both layers on the two public controllers', () => {
    const slugs = new Set(GLOBAL_ALERTS.map((alert) => alert.slug))

    for (const [controller, slug] of BESPOKE_COVERAGE) {
      expect(
        OWNED.has(controller),
        `${controller} is public and should have an owner, so it belongs to a route alert group`,
      ).toBe(true)

      expect(
        slugs.has(slug),
        `${slug} is gone from GLOBAL_ALERTS, leaving ${controller} with only a threshold-0 rule — which is the rule that gets muted if this route's error volume returns`,
      ).toBe(true)
    }
  })

  /** The paths a controller answers on, without their HTTP verbs. */
  const routePaths = (controller: ControllerName) =>
    ROUTE_MAP[controller]
      .map(({ endpoint }) => endpoint.split(' ')[1])
      .filter((path): path is string => Boolean(path))

  // The inverse, and the one that keeps the pairing above from going stale:
  // it only protects what it lists, so a third controller handed a bespoke
  // rule and not listed here is back in the state this block exists to end —
  // one deletion away from silence with nothing to say so.
  //
  // Asks the question by reading what the rules query rather than by how they
  // are spelled. Matching a slug prefix against the controller name is the
  // obvious shortcut and it is wrong: `health-check-probe-failure` starts with
  // `health`, and is the ECS probe alert rather than anything to do with the
  // `health` controller's routes. That test fails the day it is written, and
  // the only way to green it is to record in the pairing that the health
  // controller has bespoke route coverage, which is a lie the next reader
  // inherits. Querying a controller's own paths is the thing actually being
  // claimed, so it is what gets checked.
  it('lists every opted-out controller a hand-written rule already covers', () => {
    const declared = new Set(BESPOKE_COVERAGE.map(([controller]) => controller))

    const undeclared = CONTROLLERS_WITHOUT_ROUTE_ALERTS.filter(
      (controller) =>
        !declared.has(controller) &&
        GLOBAL_ALERTS.some((alert) =>
          routePaths(controller).some((path) => alert.expr.includes(path)),
        ),
    )

    expect(
      undeclared,
      "a hand-written rule in GLOBAL_ALERTS already queries these controllers' routes, but nothing pairs the two — delete that rule and the controller goes silent with every test still green",
    ).toEqual([])
  })
})

// The owner's standing rule is that any qualifying error pages. The one route
// that was exempt, voter-density, skipped real 502s on 2026-09-30 at 17:11 and
// 18:17 because its rule needed more than 2 in ten minutes.
describe('a single error pages', () => {
  const VOTER_DENSITY = 'GET /v1/public-person-profiles/voter-density'

  it('covers voter-density with a rule that fires on one error', () => {
    expect(
      ROUTE_MAP['public-person-profiles'].map(({ endpoint }) => endpoint),
    ).toContain(VOTER_DENSITY)

    const group = groupFor('public-person-profiles')
    const alert = alertFor(group.slug)

    expect(new RegExp(endpointPattern(alert.expr)).test(VOTER_DENSITY)).toBe(
      true,
    )
    expect(alert.threshold).toBe(0)
    expect(alert.message).not.toContain('more than')
  })

  it('fires on one error on every rule', () => {
    for (const alert of ALERTS) {
      expect(alert.threshold, alert.slug).toBe(0)
    }
  })
})
