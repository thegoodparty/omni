import { describe, expect, it } from 'vitest'
import { ControllerName, ROUTE_MAP } from '../../../src/generated/route-types'
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
  // feature working.
  it('pages on 5xx only for door-knocking', () => {
    for (const alert of alerts) {
      expect(alert.expr).toContain('response_statusCode >= 500')
      expect(alert.expr).not.toContain('response_statusCode >= 400')
    }
  })

  // The per-controller filter has to survive the collapse: door-knocking is
  // the only SERVER_ERRORS_ONLY controller, so a controller outside that list
  // must still get the wider filter rather than inherit its neighbour's.
  it('pages on 4xx too for a controller outside SERVER_ERRORS_ONLY', () => {
    const alert = onlyAlert('contacts')
    expect(alert.expr).toContain('response_statusCode >= 400')
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
