import { Logger } from '@nestjs/common'
import { metrics } from '@opentelemetry/api'

// Counts vendor responses that did not match our Zod schema (drift layer 1).
// Same meter pattern as geoapify.metrics.ts: a no-op unless OTLP export is
// configured, and the record is wrapped so instrumentation never breaks a call.
//
// Prometheus (via Grafana Cloud OTLP) exposes this as:
//   vendor_schema_mismatch_total{vendor=...,endpoint=...}
//
// `endpoint` must be a path TEMPLATE (`/v2/tdlc/:id/retrieve_cv`), never a
// concrete URL, or the series count grows with every identity id.
const logger = new Logger('VendorSchemaMetrics')

const isOtelEnabled = (): boolean =>
  Boolean(process.env.OTEL_EXPORTER_OTLP_HEADERS)

const environment = (): string =>
  process.env.OTEL_SERVICE_ENVIRONMENT || 'local'

const meter = metrics.getMeter('gp-api')

const schemaMismatchCounter = meter.createCounter('vendor_schema_mismatch', {
  description:
    'Vendor responses that failed their Zod schema, by vendor and endpoint',
})

export const recordVendorSchemaMismatch = (
  vendor: string,
  endpoint: string,
): void => {
  if (!isOtelEnabled()) return
  try {
    schemaMismatchCounter.add(1, {
      vendor,
      endpoint,
      environment: environment(),
    })
  } catch (error) {
    logger.error('Failed to record vendor schema mismatch metric', error)
  }
}
