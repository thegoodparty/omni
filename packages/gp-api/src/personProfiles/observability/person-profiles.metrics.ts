import { Logger } from '@nestjs/common'
import { metrics } from '@opentelemetry/api'

// Custom OTel metrics for the public /people profiles feature. Follows the
// gp-api meter pattern (see observability/grafana/otel.client.ts): a single
// module-scoped meter, no-op unless OTLP export is configured, and every record
// wrapped so instrumentation can never break a request.
const logger = new Logger('PersonProfileMetrics')

const isOtelEnabled = (): boolean =>
  Boolean(process.env.OTEL_EXPORTER_OTLP_HEADERS)

const environment = (): string =>
  process.env.OTEL_SERVICE_ENVIRONMENT || 'local'

const meter = metrics.getMeter('gp-api')

// Prometheus (via Grafana Cloud OTLP) exposes these as:
//   person_profile_public_request_count_total{result=...}
//   person_profile_public_request_duration_milliseconds_{bucket,sum,count}
//   person_profile_mutation_count_total{action=...}
//   person_profile_revalidation_count_total{result=...}
const publicRequestCounter = meter.createCounter(
  'person_profile.public_request.count',
  { description: 'Public /people profile fetches by render-gate result' },
)

const publicRequestDuration = meter.createHistogram(
  'person_profile.public_request.duration',
  {
    description: 'Latency of public /people profile fetches',
    unit: 'ms',
  },
)

const mutationCounter = meter.createCounter('person_profile.mutation.count', {
  description: 'Owner mutations to a person profile by action',
})

const revalidationCounter = meter.createCounter(
  'person_profile.revalidation.count',
  { description: 'Marketing cache revalidation attempts by result' },
)

/** Render-gate outcome for a public profile fetch. */
export type PublicProfileResult = 'live' | 'not_found' | 'gone'

/** Owner-initiated change to a profile. */
export type ProfileMutation =
  | 'create'
  | 'update'
  | 'publish'
  | 'unpublish'
  | 'delete'
  | 'set_issues'

/** Outcome of an outbound marketing cache-bust. */
export type RevalidationResult = 'success' | 'skipped' | 'failed'

export function recordPublicProfileRequest(
  result: PublicProfileResult,
  durationMs: number,
): void {
  if (!isOtelEnabled()) return
  try {
    const attrs = { result, environment: environment() }
    publicRequestCounter.add(1, attrs)
    publicRequestDuration.record(durationMs, attrs)
  } catch (error) {
    logger.error('Failed to record public profile request metric', error)
  }
}

export function recordProfileMutation(action: ProfileMutation): void {
  if (!isOtelEnabled()) return
  try {
    mutationCounter.add(1, { action, environment: environment() })
  } catch (error) {
    logger.error('Failed to record profile mutation metric', error)
  }
}

export function recordRevalidation(result: RevalidationResult): void {
  if (!isOtelEnabled()) return
  try {
    revalidationCounter.add(1, { result, environment: environment() })
  } catch (error) {
    logger.error('Failed to record revalidation metric', error)
  }
}
