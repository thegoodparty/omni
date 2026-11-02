import { Logger } from '@nestjs/common'
import { metrics } from '@opentelemetry/api'

// How many `vendor_mock_record` rows the database holds, as a gauge. Mock rows
// are written only by the non-prod vendor mocks, so any row in prod means mock
// mode reached production (the TDD's "should never happen" guard).
//
// Same meter pattern as vendorSchema.metrics.ts: a no-op unless OTLP export is
// configured, and the record is wrapped so instrumentation never breaks the
// cron that calls it.
//
// A gauge has no `_total` suffix, so Prometheus (via Grafana Cloud OTLP)
// exposes this as:
//   vendor_mock_record_rows{service_name="gp-api",deployment_environment_name=...}
const logger = new Logger('VendorMockRecordMetrics')

const isOtelEnabled = (): boolean =>
  Boolean(process.env.OTEL_EXPORTER_OTLP_HEADERS)

const environment = (): string =>
  process.env.OTEL_SERVICE_ENVIRONMENT || 'local'

const meter = metrics.getMeter('gp-api')

const mockRecordRowsGauge = meter.createGauge('vendor_mock_record_rows', {
  description: 'Rows in vendor_mock_record, which must be 0 in prod',
})

export const recordVendorMockRecordRows = (rows: number): void => {
  if (!isOtelEnabled()) return
  try {
    mockRecordRowsGauge.record(rows, { environment: environment() })
  } catch (error) {
    logger.error('Failed to record vendor mock record rows metric', error)
  }
}
