import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import { INSTRUMENTATION_SCOPE, METRIC } from 'pg-boss/dist/telemetry.js'
import { describe, expect, it } from 'vitest'
import { METRIC_VIEWS } from './metricViews'

const exportedMetricNames = async (
  record: (provider: MeterProvider) => void,
): Promise<string[]> => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
  const provider = new MeterProvider({
    views: METRIC_VIEWS,
    readers: [
      new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: 3_600_000,
      }),
    ],
  })
  record(provider)
  // Collects and exports once.
  await provider.shutdown()
  return exporter
    .getMetrics()
    .flatMap((batch) => batch.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .map((metric) => metric.descriptor.name)
}

describe('METRIC_VIEWS', () => {
  it("drops every metric pg-boss's OpenTelemetry records", async () => {
    const names = await exportedMetricNames((provider) => {
      const meter = provider.getMeter(INSTRUMENTATION_SCOPE)
      meter.createHistogram(METRIC.operationDuration).record(0.01)
      meter.createCounter(METRIC.sentMessages).add(1)
      meter.createCounter(METRIC.consumedMessages).add(1)
      meter.createHistogram(METRIC.processDuration).record(1)
      meter
        .createObservableGauge(METRIC.queueJobs)
        .addCallback((result) => result.observe(1))
    })

    expect(Object.values(METRIC)).toHaveLength(5)
    expect(names).toEqual([])
  })

  it("keeps gp-api's own metrics, the jobs wait pressure gauge included", async () => {
    const names = await exportedMetricNames((provider) => {
      provider
        .getMeter('gp-api')
        .createObservableGauge('jobs.wait_pressure')
        .addCallback((result) => result.observe(0.2, { queue: 'myJob' }))
    })

    expect(names).toEqual(['jobs.wait_pressure'])
  })

  it('still drops the HTTP server and client metrics', async () => {
    const names = await exportedMetricNames((provider) => {
      const meter = provider.getMeter('@opentelemetry/instrumentation-http')
      meter.createHistogram('http.server.request.duration').record(1)
      meter.createHistogram('http.client.request.duration').record(1)
    })

    expect(names).toEqual([])
  })
})
