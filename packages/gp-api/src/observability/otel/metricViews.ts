import { AggregationType, type ViewOptions } from '@opentelemetry/sdk-metrics'

// Lives here rather than in otel.ts for the reason resource.ts gives: that
// module starts the SDK as an import side effect, so a test cannot import it.
export const METRIC_VIEWS: ViewOptions[] = [
  {
    instrumentName: 'http.server.*',
    aggregation: { type: AggregationType.DROP },
  },
  {
    instrumentName: 'http.client.*',
    aggregation: { type: AggregationType.DROP },
  },
  // pg-boss's OpenTelemetry stays on for its spans, which keep a job's work
  // under its `process <queue>` span and link it to the request that sent
  // it. Its five metrics are labelled per queue and were exported by every
  // task, which made them most of our metric series; the jobs system is
  // watched through its logs instead (src/jobs/AGENTS.md).
  {
    meterName: 'pg-boss',
    aggregation: { type: AggregationType.DROP },
  },
]
