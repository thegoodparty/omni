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
import { controllerAlerts } from './controller-alerts'

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

  // A controller with no public routes (currently `mcp`) has nothing to watch,
  // and grafana.ts skips empty rule groups rather than fail preview.
  it('builds nothing for a controller with no routes', () => {
    expect(controllerAlerts('mcp')).toHaveLength(0)
  })

  // The rule now reads the whole gp-api stream, so the endpoint pattern is the
  // only thing keeping it to its own controller. Without it a `contacts` page
  // would fire for a `polls` route, and every unowned controller's routes —
  // which are deliberately provisioned disabled — would page through whichever
  // owned controller happened to read them first.
  it('matches every route on its own controller', () => {
    const alert = onlyAlert('contacts')
    for (const { endpoint } of ROUTE_MAP['contacts']) {
      expect(alert.expr).toContain(endpoint)
    }
  })

  it('matches no route from another controller', () => {
    const alert = onlyAlert('contacts')
    for (const { endpoint } of ROUTE_MAP['polls']) {
      expect(alert.expr).not.toContain(endpoint)
    }
  })

  // Loki anchors label-filter regexes the same way Prometheus does, but the
  // alternation is written anchored anyway: unanchored, `GET /v1/contacts`
  // would also swallow `GET /v1/contacts/:id`, silently merging two routes
  // into one alert instance and losing the one that fired second.
  it('anchors the endpoint alternation', () => {
    for (const alert of alerts) {
      expect(alert.expr).toContain('request_endpoint =~ `^(?:')
      expect(alert.expr).toContain(')$`')
    }
  })

  // The pattern goes into a LogQL raw string, which does no escape processing,
  // so a backtick in an endpoint would terminate it early and produce a query
  // that either fails to parse or matches the wrong thing.
  it('builds a pattern no endpoint can break out of', () => {
    for (const { endpoint } of Object.values(ROUTE_MAP).flat()) {
      expect(endpoint).not.toContain('`')
    }
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

  it('keeps every controller under the tenant series cap', () => {
    for (const routes of Object.values(ROUTE_MAP)) {
      expect(routes.length).toBeLessThan(MAX_QUERY_SERIES)
    }
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
  it('pages on 5xx only for door-knocking', () => {
    for (const alert of alerts) {
      expect(alert.expr).toContain('response_statusCode >= 500')
      expect(alert.expr).not.toContain('response_statusCode >= 400')
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
    const alert = onlyAlert(outsideServerErrorsOnly())
    expect(alert.expr).toContain('response_statusCode >= 400')
    expect(alert.expr).not.toContain('response_statusCode >= 500')
  })

  // The other direction, also derived: every controller ON the list gets the
  // narrow filter. Together these two mean the list is what decides, for any
  // membership, rather than door-knocking being special-cased somewhere.
  it('pages on 5xx only for every controller in SERVER_ERRORS_ONLY', () => {
    for (const name of SERVER_ERRORS_ONLY) {
      if (ROUTE_MAP[name].length === 0) continue
      const alert = onlyAlert(name)
      expect(alert.expr).toContain('response_statusCode >= 500')
      expect(alert.expr).not.toContain('response_statusCode >= 400')
    }
  })

  // The codes are written out rather than imported from the source list on
  // purpose: importing would assert the constant equals itself, and this test
  // exists to fail loudly when someone edits that list. 400 is the one worth
  // naming — it was counted until this list gained it, and a single validation
  // refusal or Pro gate hit was enough to page, which is what taught us a 400
  // is never evidence of a fault on its own.
  it('excludes the designed client-error vocabulary, 400 included', () => {
    const alert = onlyAlert(outsideServerErrorsOnly())
    for (const code of [400, 401, 403, 404, 409, 498]) {
      expect(alert.expr).toContain(`response_statusCode != ${code}`)
    }
  })

  // The prose used to restate the exclusions as a hardcoded string, so it was
  // one edit away from telling whoever it paged that a status it had just
  // stopped counting was still in scope. Both sides now read one constant;
  // this pins them together without naming the codes a third time.
  it('tells the reader the same exclusions the filter applies', () => {
    const alert = onlyAlert(outsideServerErrorsOnly())
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
    for (const alert of alerts) {
      expect(alert.expr).toContain('response_statusCode = ""')
      expect(alert.message).toContain('null')
    }
  })

  // It has to catch the timeout without dragging the 4xx vocabulary back in —
  // a null status is the absence of one, so it can't overlap with 429 or 400.
  it('admits no 4xx alongside the null-status clause', () => {
    for (const alert of alerts) {
      expect(alert.expr).not.toMatch(/response_statusCode\s*[<>=!]+\s*4\d\d/)
    }
  })

  // `A and B or C` is one precedence misread away from paging on every 401.
  it('parenthesizes the status clauses', () => {
    for (const alert of alerts) {
      expect(alert.expr).toContain('( response_statusCode >= 500 ) or (')
    }
  })
})

// The gap these guard is not a wrong alert but an absent one, which is the
// failure mode no alert can report. `controllerAlerts` sets
// `disabled: !slackGroupName`, so a controller nobody lists is silently opted
// out — and 71 of 77 are. CONTROLLERS_WITHOUT_ROUTE_ALERTS makes that a
// declaration rather than an oversight, and these are what make the
// declaration mandatory.
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
