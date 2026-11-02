import { Logger } from '@nestjs/common'
import { metrics } from '@opentelemetry/api'

// How many users the deploy's Clerk instance holds, as a gauge. The dev
// instance is shared by every E2E run and has a hard user cap; it hit it on
// 2026-09-29, and the hourly test-user sweep is all that holds it down.
//
// Same meter pattern as vendorMockRecord.metrics.ts: a no-op unless OTLP export
// is configured, and the record is wrapped so instrumentation never breaks the
// sweep that calls it. Prometheus (via Grafana Cloud OTLP) exposes it as:
//   clerk_users{population="all"|"test_domain", deployment_environment_name}
const logger = new Logger('ClerkUsersMetrics')

const isOtelEnabled = (): boolean =>
  Boolean(process.env.OTEL_EXPORTER_OTLP_HEADERS)

const environment = (): string =>
  process.env.OTEL_SERVICE_ENVIRONMENT || 'local'

const meter = metrics.getMeter('gp-api')

const clerkUsersGauge = meter.createGauge('clerk_users', {
  description: 'Users in the Clerk instance, all and @test.goodparty.org',
})

export const recordClerkUserCounts = (counts: {
  total: number
  testDomain: number
}): void => {
  if (!isOtelEnabled()) return
  try {
    clerkUsersGauge.record(counts.total, {
      population: 'all',
      environment: environment(),
    })
    clerkUsersGauge.record(counts.testDomain, {
      population: 'test_domain',
      environment: environment(),
    })
  } catch (error) {
    logger.error('Failed to record Clerk user count metric', error)
  }
}
