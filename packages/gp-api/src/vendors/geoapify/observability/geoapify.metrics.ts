import { Logger } from '@nestjs/common'
import { metrics } from '@opentelemetry/api'

// Everything Geoapify bills for is counted here. Follows the gp-api meter
// pattern (see observability/grafana/otel.client.ts): one module-scoped meter,
// a no-op unless OTLP export is configured, and every record wrapped so
// instrumentation can never break a request.
//
// Nothing on this surface may be derived from the request URL or the caught
// error: the Route Planner SDK builds its URL with the API key in a query
// param, so a label sourced from either would publish the key to Prometheus.
// Every attribute below is a closed set of literals.
const logger = new Logger('GeoapifyMetrics')

const isOtelEnabled = (): boolean =>
  Boolean(process.env.OTEL_EXPORTER_OTLP_HEADERS)

const environment = (): string =>
  process.env.OTEL_SERVICE_ENVIRONMENT || 'local'

const meter = metrics.getMeter('gp-api')

// Prometheus (via Grafana Cloud OTLP) exposes these as:
//   geoapify_vendor_call_count_total{api=...,result=...}
//   geoapify_credits_total{api=...}
const vendorCallCounter = meter.createCounter('geoapify.vendor_call.count', {
  description: 'Billed Geoapify API calls by API and result',
})

// One counter split by `api` rather than a counter per API, and keyed on the
// same closed set the call counter uses. A single route spends at two APIs at
// two completely different rates, so the two questions worth asking are the
// total and the split — both one query off one series, neither needing a
// dashboard to remember which counters to sum. It also means a third billed
// API arrives as an attribute value instead of a counter that every existing
// total silently omits.
const creditsCounter = meter.createCounter('geoapify.credits', {
  description: 'Geoapify credits billed by door knocking, by API',
})

/**
 * Which billed Geoapify API a call hit. One create makes two: a
 * `route_planner` optimization and a `routing` fetch for the path geometry.
 * The waypoint ledger counts only the first in its `waypoints` column, which
 * is the unit the per-organization quota caps; its `credits` column and the
 * counters here cover both.
 */
export type GeoapifyApi = 'route_planner' | 'routing'

export type GeoapifyCallResult = 'success' | 'failed'

export const recordGeoapifyCall = (
  api: GeoapifyApi,
  result: GeoapifyCallResult,
): void => {
  if (!isOtelEnabled()) return
  try {
    vendorCallCounter.add(1, { api, result, environment: environment() })
  } catch (error) {
    logger.error('Failed to record Geoapify vendor call metric', error)
  }
}

// Credits rather than waypoints or calls: credits are the unit Geoapify's
// shared daily pool is denominated in, and neither of the other two converts
// into it — the Route Planner's rate is quadratic under ten locations. Kept
// free of an organization attribute on purpose — per-org spend is attributed
// in the DoorKnockingSpend log line instead, where high cardinality is free.
export const recordGeoapifyCredits = (
  api: GeoapifyApi,
  credits: number,
): void => {
  if (!isOtelEnabled()) return
  try {
    creditsCounter.add(credits, { api, environment: environment() })
  } catch (error) {
    logger.error('Failed to record Geoapify credits', error)
  }
}
