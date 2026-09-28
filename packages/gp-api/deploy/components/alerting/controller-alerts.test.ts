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
  ROUTE_ERROR_THRESHOLDS,
  SERVER_ERRORS_ONLY,
} from '../alerts'
import { buildAlertDescription } from './alert-notification'
import {
  ANY_ERROR_METRIC,
  ROUTE_RECORDING_RULES,
  SERVER_ERROR_METRIC,
  controllerAlerts,
  promEndpointPattern,
} from './controller-alerts'

/**
 * The single alert a controller now produces. Asserting the count here rather
 * than indexing keeps `noUncheckedIndexedAccess` satisfied and re-checks the
 * one-rule-per-controller invariant at every call site.
 */
const onlyAlert = (controller: ControllerName) => {
  const [alert, ...rest] = controllerAlerts(controller)
  if (!alert || rest.length > 0) {
    throw new Error(`expected exactly one alert for ${controller}`)
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

// Mirrors grafana.ts's `alert.timeRangeSeconds ?? 600` — the window the
// alerting engine actually fetches when an alert does not pin its own.
const DEFAULT_FETCH_SECONDS = 600

// `max_query_series` on the Loki tenant. One rule now returns one series per
// route on its controller, so the widest controller has to stay under it.
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

/** Seconds the notification tells the reader it looked back over. */
const promisedSeconds = (message: string) => {
  const match = /in the last (\d+) (seconds|minutes|hours)/.exec(message)
  const [, amount, unit] = match ?? []
  if (!amount || !unit) {
    throw new Error(`message does not state a numeric window: ${message}`)
  }
  return toSeconds(amount, unit)
}

/**
 * The recording rule that writes a metric.
 *
 * The status vocabulary now lives on the two Loki reads rather than on the 74
 * alerts, so every assertion about WHICH statuses count has to find its rule.
 * Looked up by metric rather than by index so the pairing being asserted is
 * the one the alerts actually resolve, not whichever rule happens to be first.
 */
const ruleWriting = (metric: string) => {
  const rule = ROUTE_RECORDING_RULES.find((one) => one.metric === metric)
  if (!rule) {
    throw new Error(`no recording rule writes ${metric}`)
  }
  return rule
}

const anyErrorRule = ruleWriting(ANY_ERROR_METRIC)
const serverErrorRule = ruleWriting(SERVER_ERROR_METRIC)

/** The recorded metric a generated alert reads. */
const selectedMetric = (expr: string) => {
  const [, metric] =
    /sum_over_time\(([a-zA-Z_:][a-zA-Z0-9_:]*)\{/.exec(expr) ?? []
  if (!metric) {
    throw new Error(`no recorded metric in expr: ${expr}`)
  }
  return metric
}

/** The endpoint alternation out of a PromQL label matcher. */
const endpointPattern = (expr: string) => {
  const [, pattern] = /request_endpoint=~"([^"]*)"/.exec(expr) ?? []
  if (pattern === undefined) {
    throw new Error(`no endpoint matcher in expr: ${expr}`)
  }
  return pattern
}

/**
 * The pattern as the regex engine will see it, not as it is written.
 *
 * PromQL unescapes a double-quoted string Go-style before the matcher compiles
 * it, so the `\\` the generator writes is one `\` by then. Building a RegExp
 * from the raw string would test an escape layer that never reaches a regex
 * engine, and every metacharacter assertion below would be wrong.
 */
const asRegExp = (pattern: string) => new RegExp(pattern.replace(/\\\\/g, '\\'))

describe('controllerAlerts', () => {
  const alerts = controllerAlerts('door-knocking')

  // The cost regression this collapse exists to fix. Loki bills bytes it
  // decompresses, and only the stream selector and time range decide that —
  // every filter after the `}` runs on data already paid for. So the old
  // shape, one rule per route, re-read the whole gp-api stream once per route
  // per minute: 53 rules across the six owned controllers, ~4.3 TB/day, which
  // is most of what pushed August past the 100:1 query-to-ingest allowance.
  // One rule per controller reads that stream once and splits the result.
  it('builds one alert for the whole controller, not one per route', () => {
    expect(alerts).toHaveLength(1)
    expect(ROUTE_MAP['door-knocking'].length).toBeGreaterThan(1)
  })

  it('splits the single read into one series per route', () => {
    for (const alert of alerts) {
      expect(alert.expr).toContain('sum by (request_endpoint)')
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
    const alert = onlyAlert('mcp')

    expect(alert.expr).toContain('GET /v1/mcp')
    expect(alert.expr).toContain('POST /v1/mcp')
    expect(alert.disabled).toBe(false)
    expect([alert.notify ?? []].flat()).toEqual(['serve-bugs', 'win-bugs'])
  })

  // The rule now reads the whole gp-api stream, so the endpoint pattern is the
  // only thing keeping it to its own controller. Without it a `contacts` page
  // would fire for a `polls` route, and every unowned controller's routes —
  // which are deliberately provisioned disabled — would page through whichever
  // owned controller happened to read them first.
  it('matches every route on its own controller', () => {
    const pattern = asRegExp(endpointPattern(onlyAlert('contacts').expr))
    for (const { endpoint } of ROUTE_MAP['contacts']) {
      expect(pattern.test(endpoint), endpoint).toBe(true)
    }
  })

  it('matches no route from another controller', () => {
    const pattern = asRegExp(endpointPattern(onlyAlert('contacts').expr))
    for (const { endpoint } of ROUTE_MAP['polls']) {
      expect(pattern.test(endpoint), endpoint).toBe(false)
    }
  })

  // Prometheus anchors label-matcher regexes on its own, but the alternation
  // is written anchored anyway: unanchored, `GET /v1/contacts` would also
  // swallow `GET /v1/contacts/:id`, silently merging two routes into one alert
  // instance and losing the one that fired second.
  it('anchors the endpoint alternation', () => {
    for (const alert of alerts) {
      const pattern = endpointPattern(alert.expr)
      expect(pattern.startsWith('^(?:')).toBe(true)
      expect(pattern.endsWith(')$')).toBe(true)

      const compiled = asRegExp(pattern)
      for (const { endpoint } of ROUTE_MAP['door-knocking']) {
        expect(compiled.test(`${endpoint}/zzz`), endpoint).toBe(false)
      }
    }
  })

  // The pattern goes into a PromQL double-quoted string, so a `"` reaching it
  // would terminate that string early and produce a rule that either fails to
  // parse at provision time or matches the wrong thing.
  it('builds a pattern no endpoint can break out of', () => {
    for (const { endpoint } of Object.values(ROUTE_MAP).flat()) {
      expect(endpoint).not.toContain('"')
    }

    for (const controller of CONTROLLER_NAMES) {
      const routes = ROUTE_MAP[controller]
      if (routes.length === 0) continue

      const pattern = promEndpointPattern(
        routes.map(({ endpoint }) => endpoint),
      )
      expect(pattern, controller).not.toContain('"')
    }
  })

  // THE SUBTLEST THING IN THIS FILE, and the only regression here that fails
  // nowhere else: the endpoint's regex escaping has to survive being written
  // inside a PromQL double-quoted string, which unescapes `\\` to `\` the way
  // Go does. A single backslash is an invalid string escape, so Grafana
  // rejects the rule at provision time rather than failing any assertion — the
  // alert simply never exists. No real endpoint carries a metacharacter today,
  // so this is pinned against a synthetic one rather than the route map.
  it('doubles the backslash so PromQL unescaping leaves exactly one', () => {
    const pattern = promEndpointPattern(['GET /v1/a.b'])

    expect(pattern).toBe('^(?:GET /v1/a\\\\.b)$')

    const compiled = asRegExp(pattern)
    expect(compiled.test('GET /v1/a.b')).toBe(true)
    expect(compiled.test('GET /v1/aXb')).toBe(false)
  })

  // Grafana renders annotations per alert instance, so this is what turns one
  // rule back into a page that names the route that broke. Without it the
  // notification says only which controller is unhappy, which is a strictly
  // worse page than the per-route rules it replaces.
  it('names the offending route in the notification', () => {
    for (const alert of alerts) {
      expect(alert.summaryDetail).toContain('$labels.request_endpoint')
      expect(alert.message).toContain('$labels.request_endpoint')
    }
  })

  // The rule counts "Request completed" lines, which carry the status but
  // not the cause. The cause is on the exception lines for the same request,
  // one query away — and on 2026-09-22 a POST /v1/outreach/sms/draft page
  // took a Loki session to learn it was a schema-length reject, not the
  // gateway timeout the message warns about. The link lands the reader on
  // those lines for the route that actually fired.
  it('links the reader to the error lines for the route that fired', () => {
    for (const alert of alerts) {
      expect(alert.message).toContain('https://goodparty.grafana.net/explore')
      expect(alert.message).toContain(
        '{{ $labels.request_endpoint | urlquery }}',
      )
      expect(alert.message).toContain('exception_type')

      const description = buildAlertDescription(alert, 'prod')
      expect(description).toContain('deployment_environment_name')
      expect(description).toContain('prod')
      expect(description).not.toContain('$ENV')
    }
  })

  it('keeps every controller under the tenant series cap', () => {
    for (const routes of Object.values(ROUTE_MAP)) {
      expect(routes.length).toBeLessThan(MAX_QUERY_SERIES)
    }

    // The fan-out moved with the Loki read. One recording rule now covers
    // every controller at once, so the query that has to stay under the cap
    // returns one series per route in the whole service, not per controller.
    expect(Object.values(ROUTE_MAP).flat().length).toBeLessThan(
      MAX_QUERY_SERIES,
    )
  })

  // The regression: the vector was written `[1h]` while these alerts take the
  // default 600s fetch, which silently caps it. The rule only ever saw ten
  // minutes of logs, so the extra fifty minutes of vector bought nothing.
  it('keeps the range vector inside the window the engine fetches', () => {
    for (const alert of alerts) {
      const fetched = alert.timeRangeSeconds ?? DEFAULT_FETCH_SECONDS
      expect(rangeSeconds(alert.expr)).toBeLessThanOrEqual(fetched)
    }
  })

  // The other half of that regression, and the one a responder pays for: the
  // message said "in the last hour", so triage swept an hour of logs for
  // errors that could only have come from the last ten minutes.
  it('promises the reader the window it actually queried', () => {
    for (const alert of alerts) {
      expect(promisedSeconds(alert.message)).toEqual(rangeSeconds(alert.expr))
    }
  })

  // SERVER_ERRORS_ONLY: door knocking answers an over-budget knock with 429
  // and an ineligible district with 400, so paging on 4xx would page on the
  // feature working. Now that 400 is excluded everywhere, 429 is the part
  // still doing the work here — the 400s would be dropped by the default
  // filter too.
  //
  // Two halves now, because the filter and the choice of filter live in
  // different places: the recording rule decides what `>= 500` means, and the
  // alert decides which of the two recorded metrics it reads. Asserting only
  // the first would let a refactor point every controller at the wide metric
  // with this test still green.
  it('pages on 5xx only for door-knocking', () => {
    expect(serverErrorRule.expr).toContain('response_statusCode >= 500')
    expect(serverErrorRule.expr).not.toContain('response_statusCode >= 400')

    for (const alert of alerts) {
      expect(selectedMetric(alert.expr)).toBe(SERVER_ERROR_METRIC)
    }
  })

  // The per-controller filter has to survive the collapse: a controller outside
  // SERVER_ERRORS_ONLY must still get the wider filter rather than inherit its
  // neighbour's.
  //
  // The subject is DERIVED rather than named, because naming one is how this
  // test rots. It said `contacts` until `contacts` was added to the list, at
  // which point the assertion inverted and the failure read as a bug in the
  // filter rather than a stale fixture.
  it('pages on 4xx too for a controller outside SERVER_ERRORS_ONLY', () => {
    expect(anyErrorRule.expr).toContain('response_statusCode >= 400')
    expect(anyErrorRule.expr).not.toContain('response_statusCode >= 500')

    const alert = onlyAlert(outsideServerErrorsOnly())
    expect(selectedMetric(alert.expr)).toBe(ANY_ERROR_METRIC)
  })

  // The other direction, also derived: every controller ON the list gets the
  // narrow filter. Together these two mean the list is what decides, for any
  // membership, rather than door-knocking being special-cased somewhere.
  it('pages on 5xx only for every controller in SERVER_ERRORS_ONLY', () => {
    expect(serverErrorRule.expr).toContain('response_statusCode >= 500')
    expect(serverErrorRule.expr).not.toContain('response_statusCode >= 400')

    for (const name of SERVER_ERRORS_ONLY) {
      if (ROUTE_MAP[name].length === 0) continue
      expect(selectedMetric(onlyAlert(name).expr), name).toBe(
        SERVER_ERROR_METRIC,
      )
    }
  })

  // The codes are written out rather than imported from the source list on
  // purpose: importing would assert the constant equals itself, and this test
  // exists to fail loudly when someone edits that list. 400 is the one worth
  // naming — it was counted until this list gained it, and a single validation
  // refusal or Pro gate hit was enough to page, which is what taught us a 400
  // is never evidence of a fault on its own.
  it('excludes the designed client-error vocabulary, 400 included', () => {
    for (const code of [400, 401, 403, 404, 409, 498]) {
      expect(anyErrorRule.expr).toContain(`response_statusCode != ${code}`)
    }
  })

  // The prose used to restate the exclusions as a hardcoded string, so it was
  // one edit away from telling whoever it paged that a status it had just
  // stopped counting was still in scope. Both sides now read one constant;
  // this pins them together without naming the codes a third time. The filter
  // moved onto the recording rule and the prose stayed on the alert, so the
  // two halves are read from different objects — which is precisely the split
  // that makes them able to drift.
  it('tells the reader the same exclusions the filter applies', () => {
    const alert = onlyAlert(outsideServerErrorsOnly())
    const filtered = [
      ...anyErrorRule.expr.matchAll(/response_statusCode != (\d+)/g),
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
    for (const rule of ROUTE_RECORDING_RULES) {
      expect(rule.expr, rule.slug).toContain('response_statusCode = ""')
    }
    for (const alert of alerts) {
      expect(alert.message).toContain('null')
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
    for (const rule of ROUTE_RECORDING_RULES) {
      expect(rule.expr, rule.slug).toMatch(/responseTimeMs > \d+/)
    }
  })

  // The floor has to sit between the two populations it separates: above any
  // real handler, and below the gateway's ~120s idle timeout, or it discards
  // the timeouts the clause exists to catch along with the aborts.
  it('puts the floor under the gateway timeout it has to catch', () => {
    for (const rule of ROUTE_RECORDING_RULES) {
      const floor = Number(/responseTimeMs > (\d+)/.exec(rule.expr)?.[1])

      expect(floor, rule.slug).toBeGreaterThan(5_000)
      expect(floor, rule.slug).toBeLessThan(120_000)
    }
  })

  // The message tells whoever is paged what to look for, so it has to state the
  // floor. Reading "the request was killed in flight" and then finding nothing
  // under 30s in the logs is how someone concludes the alert is broken.
  it('says that short no-status requests are excluded', () => {
    for (const alert of alerts) {
      expect(alert.message).toMatch(/30 seconds/)
    }
  })

  // It has to catch the timeout without dragging the 4xx vocabulary back in —
  // a null status is the absence of one, so it can't overlap with 429 or 400.
  // Asserted on the server-error rule only, which is the same scope it always
  // had: the wide rule names 4xx codes deliberately, to exclude them.
  it('admits no 4xx alongside the null-status clause', () => {
    expect(serverErrorRule.expr).not.toMatch(
      /response_statusCode\s*[<>=!]+\s*4\d\d/,
    )
  })

  // `A and B or C` is one precedence misread away from paging on every 401.
  it('parenthesizes the status clauses', () => {
    expect(serverErrorRule.expr).toContain(
      '( response_statusCode >= 500 ) or (',
    )
    expect(anyErrorRule.expr).toContain('( response_statusCode >= 400')
    expect(anyErrorRule.expr).toContain(') or (')
  })
})

// The two Loki reads that replaced 74. Everything the generated alerts stopped
// asserting when they became PromQL is asserted here instead, plus the cost
// property that is the whole reason they exist.
describe('route recording rules', () => {
  it('writes two distinct, valid Prometheus metric names', () => {
    expect(ROUTE_RECORDING_RULES).toHaveLength(2)

    const metrics = ROUTE_RECORDING_RULES.map((rule) => rule.metric)
    expect(new Set(metrics).size).toBe(metrics.length)

    for (const metric of metrics) {
      expect(metric).toMatch(/^[a-zA-Z_:][a-zA-Z0-9_:]*$/)
    }
  })

  // A typo'd metric name is the one failure here that reports nothing: the
  // alert queries a series nobody writes, gets no data, and `noDataState: 'OK'`
  // calls that healthy. The rule stays green in Grafana forever while the
  // routes behind it are unwatched.
  it('records every metric a generated alert reads', () => {
    const recorded = new Set(ROUTE_RECORDING_RULES.map((rule) => rule.metric))

    for (const controller of CONTROLLER_NAMES) {
      if (ROUTE_MAP[controller].length === 0) continue

      const metric = selectedMetric(onlyAlert(controller).expr)
      expect(recorded.has(metric), `${controller} reads ${metric}`).toBe(true)
    }
  })

  // THE COST PROPERTY, AS A TEST. A rule's Loki bill is its fetch window
  // divided by its evaluation interval — the number of times a day it re-reads
  // the same bytes. At 1:1 each log line is read exactly once, which is the
  // floor and is the entire point of this collapse. A window wider than the
  // interval silently re-reads, which is the defect that produced 2,690 GB/day
  // and the 2026-09-28 429s, so it fails the suite rather than living in a
  // comment. The width is read out of the expression rather than hardcoded:
  // widening `[1m]` without widening the offsets is exactly the edit this
  // catches.
  it('reads each log line exactly once', () => {
    for (const rule of ROUTE_RECORDING_RULES) {
      const width = rangeSeconds(rule.expr)

      expect(rule.fromSeconds - rule.toSeconds, rule.slug).toEqual(width)
      expect(width, rule.slug).toEqual(rule.intervalSeconds)
    }
  })

  // The window has to END in the past. Log lines reach Loki several seconds
  // after the request they describe, so a window ending at `now` misses the
  // last few seconds — and, unlike an overlapping window, never sees them
  // again, because the next evaluation starts where this one ended. Those
  // lines are lost permanently, and nothing anywhere would say so.
  it('ends its window before now, to clear the ingestion lag', () => {
    for (const rule of ROUTE_RECORDING_RULES) {
      expect(rule.toSeconds, rule.slug).toBeGreaterThan(0)
    }
  })

  // Both rules read the one stream the alerts used to each read for
  // themselves, and both carry `$ENV` — grafana.ts substitutes the environment
  // into `expr` on provision, and a rule that hardcoded one would have dev and
  // prod writing the same series from the same logs.
  it('reads one stream, in the environment grafana.ts substitutes', () => {
    for (const rule of ROUTE_RECORDING_RULES) {
      expect(rule.expr, rule.slug).toContain(
        '{service_name="gp-api", deployment_environment_name="$ENV"}',
      )
      expect(rule.expr, rule.slug).toContain('|= "Request completed"')
    }
  })
})

// The gap these guard is not a wrong alert but an absent one, which is the
// failure mode no alert can report. `controllerAlerts` sets
// `disabled: !owners.length`, so a controller nobody lists is silently opted
// out. CONTROLLERS_WITHOUT_ROUTE_ALERTS makes that a declaration rather than an
// oversight, and these are what make the declaration mandatory.
describe('every controller is accounted for', () => {
  const owned = new Set(Object.values(ALERT_OWNERSHIP).flat())
  const unmonitored = new Set(CONTROLLERS_WITHOUT_ROUTE_ALERTS)

  // The one that matters: a controller added tomorrow lands in neither list and
  // fails here, so the author picks an owner or writes down that they did not
  // want one. Without this, a new public endpoint inherits silence by default
  // and nothing says so — which is how public-person-profiles/voter-density
  // served 1,498,324 consecutive 500s over four days in August 2026 without
  // paging anyone.
  it('requires a new controller to choose an owner or opt out', () => {
    const unaccounted = CONTROLLER_NAMES.filter(
      (controller) => !owned.has(controller) && !unmonitored.has(controller),
    )

    expect(
      unaccounted,
      'these controllers are in neither ALERT_OWNERSHIP nor CONTROLLERS_WITHOUT_ROUTE_ALERTS, so they have no route alerting and nothing records that',
    ).toEqual([])
  })

  // The new shape's own silent default. `disabled` is derived from how many
  // groups own a controller, so an entry left as `[]` — a half-finished edit, a
  // group removed without picking a replacement — reads as owned in
  // CONTROLLER_OWNERS while provisioning the alert disabled. That is precisely
  // the failure this block exists to prevent, wearing a costume: the map looks
  // right and the route is silent.
  it('never claims an owner it does not name', () => {
    const ownerless = CONTROLLER_NAMES.filter((controller) => {
      if (ROUTE_MAP[controller].length === 0) return false
      const [alert] = controllerAlerts(controller)
      const owners = [alert?.notify ?? []].flat()
      return owners.length === 0 && !unmonitored.has(controller)
    })

    expect(
      ownerless,
      'these controllers have an empty owner list, so their alert is provisioned disabled while the map reads as owned',
    ).toEqual([])
  })

  // A fifth of these controllers are shared, and `notify` only became a list so
  // that could be said out loud. If a later edit collapses them to one group,
  // the alert still fires and still looks owned — the other team just silently
  // stops being told, which is the same class of bug as the `find` this
  // replaced.
  it('still tags both groups where a controller is shared', () => {
    const shared = CONTROLLER_NAMES.filter((controller) => {
      if (ROUTE_MAP[controller].length === 0) return false
      const [alert] = controllerAlerts(controller)
      return [alert?.notify ?? []].flat().length > 1
    })

    expect(
      shared.length,
      'no controller notifies more than one group, so either the shared surfaces lost an owner or notify stopped carrying lists',
    ).toBeGreaterThan(0)

    for (const controller of shared) {
      const [alert] = controllerAlerts(controller)
      const owners = [alert?.notify ?? []].flat()

      expect(new Set(owners).size, `${controller} names a group twice`).toBe(
        owners.length,
      )
    }
  })

  // Listing a controller in both reads as "owned" here and "deliberately
  // silent" there, and the code would honour the first while a reviewer
  // believes the second.
  it('never claims a controller is both owned and opted out', () => {
    const both = CONTROLLERS_WITHOUT_ROUTE_ALERTS.filter((controller) =>
      owned.has(controller),
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

  // The list has to describe what the generator actually does, or it documents
  // an intention the code does not implement.
  it('matches which alerts are really provisioned disabled', () => {
    for (const controller of CONTROLLER_NAMES) {
      if (ROUTE_MAP[controller].length === 0) continue

      const [alert] = controllerAlerts(controller)
      expect(alert?.disabled, `${controller}`).toBe(unmonitored.has(controller))
    }
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
        owned.has(controller),
        `${controller} is public and should have an owner, so its generated route alert is enabled`,
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

// Raising a controller's threshold buys quiet by giving up the first error or
// two, which is a trade worth making on exactly one kind of route and a way to
// go silent everywhere else. These are what keep an entry honest.
describe('route error thresholds', () => {
  const raised = Object.keys(ROUTE_ERROR_THRESHOLDS) as ControllerName[]

  // The default is the whole safety story for every controller not listed: one
  // error still pages. If this inverts, a typo in the map silences the estate.
  it('leaves an unlisted controller paging on a single error', () => {
    for (const controller of CONTROLLER_NAMES) {
      if (ROUTE_MAP[controller].length === 0) continue
      if (controller in ROUTE_ERROR_THRESHOLDS) continue

      expect(onlyAlert(controller).threshold, `${controller}`).toBe(0)
    }
  })

  it('applies the configured threshold to the generated rule', () => {
    for (const controller of raised) {
      expect(onlyAlert(controller).threshold, `${controller}`).toBe(
        ROUTE_ERROR_THRESHOLDS[controller],
      )
    }
  })

  // An entry of 0 is the default wearing a costume: it reads as "measured and
  // tuned" in a diff while changing nothing, and the next person to widen it
  // starts from a number nobody chose.
  it('never lists a controller at the default', () => {
    for (const controller of raised) {
      const threshold = ROUTE_ERROR_THRESHOLDS[controller]
      expect(threshold, `${controller}`).toBeGreaterThan(0)
      expect(
        Number.isInteger(threshold),
        `${controller} is not a whole count`,
      ).toBe(true)
    }
  })

  // The map is keyed by ControllerName, so a typo fails to compile — but an
  // entry outlives the controller it names, and a silent no-op entry would
  // absorb a future controller that reused the name.
  it('names only controllers that have routes', () => {
    for (const controller of raised) {
      expect(ROUTE_MAP[controller].length, `${controller}`).toBeGreaterThan(0)
    }
  })

  // Raising the bar on a rule that is provisioned disabled is a claim about
  // nothing, and reads in review as though the route were covered.
  it('only raises the bar on a rule that is actually enabled', () => {
    for (const controller of raised) {
      expect(onlyAlert(controller).disabled, `${controller}`).toBe(false)
    }
  })

  // THE ONE THAT MATTERS. Giving up the first errors is only safe because a
  // second rule still answers "is this route substantially broken" — on
  // public-person-profiles that is the ratio rule, and it is what would have
  // caught the August outage on its first window. Delete it and this map
  // quietly becomes the thing that hides the next one.
  it('keeps a hand-written rule covering every controller it quiets', () => {
    for (const controller of raised) {
      const paths = ROUTE_MAP[controller]
        .map(({ endpoint }) => endpoint.split(' ')[1])
        .filter((path): path is string => Boolean(path))

      expect(
        GLOBAL_ALERTS.some((alert) =>
          paths.some((path) => alert.expr.includes(path)),
        ),
        `${controller} has a raised route-error threshold and no hand-written rule querying its routes, so a fault below that threshold now pages nobody at all`,
      ).toBe(true)
    }
  })

  // The notification is read by someone deciding how urgent this is, and "it
  // returned errors" and "it returned more than two errors" are different
  // incidents. The prose is generated, so it can drift from the evaluator.
  it('states the count it took to fire, and only when raised', () => {
    for (const controller of CONTROLLER_NAMES) {
      if (ROUTE_MAP[controller].length === 0) continue

      const alert = onlyAlert(controller)
      const expected =
        alert.threshold > 0 ? `more than ${alert.threshold} ` : ''

      expect(alert.message, `${controller}`).toContain(`returned ${expected}`)
      if (alert.threshold === 0) {
        expect(alert.message, `${controller}`).not.toContain('more than')
      }
    }
  })
})
