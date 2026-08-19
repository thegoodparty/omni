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
//   geoapify_route_planner_credits_total{}
const vendorCallCounter = meter.createCounter('geoapify.vendor_call.count', {
  description: 'Billed Geoapify API calls by API and result',
})

const routePlannerCreditsCounter = meter.createCounter(
  'geoapify.route_planner.credits',
  { description: 'Geoapify Route Planner credits billed by door knocking' },
)

/**
 * Which billed Geoapify API a call hit. One knock makes two: a
 * `route_planner` optimization and a `routing` fetch for the path geometry.
 * Only the first is in the waypoint ledger, so `routing` is counted here or
 * nowhere.
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

// Credits rather than waypoints: credits are the unit Geoapify's shared daily
// pool is denominated in, so this is the series a global ceiling reads. Kept
// free of an organization attribute on purpose — per-org spend is attributed
// in the DoorKnockingSpend log line instead, where high cardinality is free.
export const recordRoutePlannerCredits = (credits: number): void => {
  if (!isOtelEnabled()) return
  try {
    routePlannerCreditsCounter.add(credits, { environment: environment() })
  } catch (error) {
    logger.error('Failed to record Geoapify route planner credits', error)
  }
}
