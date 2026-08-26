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

// person_profile_claim_request_crm_sync_count_total{result=...}
const claimRequestCrmSyncCounter = meter.createCounter(
  'person_profile.claim_request_crm_sync.count',
  {
    description:
      'candidate_profile_requests writes to the candidate HubSpot contact by result',
  },
)

// person_profile_person_id_drift_count_total{result=...}
const personIdDriftCounter = meter.createCounter(
  'person_profile.person_id_drift.count',
  {
    description:
      'Re-resolutions of a linked user against the civics spine by outcome',
  },
)

// person_profile_voter_density_request_count_total{result=...}
// person_profile_voter_density_request_duration_milliseconds_{bucket,sum,count}
const voterDensityCounter = meter.createCounter(
  'person_profile.voter_density_request.count',
  { description: 'Public voter-density heat-map proxy requests by result' },
)

const voterDensityDuration = meter.createHistogram(
  'person_profile.voter_density_request.duration',
  {
    description: 'Latency of public voter-density heat-map proxy requests',
    unit: 'ms',
  },
)

/**
 * Render-gate outcome for a public profile fetch. `unpublished` used to be
 * folded into `not_found`, which hid how often an owner's draft was being
 * served as if the person had never claimed anything.
 */
export type PublicProfileResult =
  | 'live'
  | 'not_found'
  | 'gone'
  | 'removed'
  | 'unpublished'

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

/**
 * Outcome of a candidate_profile_requests write to HubSpot:
 *  - success:    the candidate's contact now holds the current count
 *  - skipped:    HubSpot is unconfigured (off-prod), so nothing was attempted
 *  - no_contact: the person maps to no HubSpot contact — expected and common
 *  - failed:     the warehouse lookup or the HubSpot write errored
 *
 * `no_contact` is the one to watch: a sustained 100% share means the person↔
 * contact linkage is unreachable, not that the counter is working.
 */
export type ClaimRequestCrmSyncResult =
  | 'success'
  | 'skipped'
  | 'no_contact'
  | 'failed'

/**
 * Outcome of a public voter-density proxy request:
 *  - live:        district resolved and cells returned
 *  - empty:       district resolved but upstream had no cells (low/no coverage)
 *  - no_district: person mapped to no L2 district (no map rendered)
 *  - error:       upstream (election-api / people-api) failure
 */
export type VoterDensityResult = 'live' | 'empty' | 'no_district' | 'error'

/**
 * Outcome of re-resolving one already-linked user against election-api:
 *  - unchanged:  the stored personId is still the canonical one (the norm)
 *  - repointed:  the data platform moved them, and we carried our rows across
 *  - collision:  the destination id is already occupied, so nothing moved
 *  - unresolved: election-api returned no id, so we cannot tell drift from an
 *                outage and deliberately left the link alone
 *  - failed:     the repoint itself errored; the link is still stale
 *
 * `collision` is the one to alert on: it means two gp-api records now claim
 * civics ids that upstream says are the same person, and only a human can pick
 * a winner. A sustained `unresolved` share means election-api is failing, not
 * that the cohort is unlinked.
 */
export type PersonIdDriftResult =
  | 'unchanged'
  | 'repointed'
  | 'collision'
  | 'unresolved'
  | 'failed'

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

export function recordClaimRequestCrmSync(
  result: ClaimRequestCrmSyncResult,
): void {
  if (!isOtelEnabled()) return
  try {
    claimRequestCrmSyncCounter.add(1, { result, environment: environment() })
  } catch (error) {
    logger.error('Failed to record claim request CRM sync metric', error)
  }
}

export function recordPersonIdDrift(result: PersonIdDriftResult): void {
  if (!isOtelEnabled()) return
  try {
    personIdDriftCounter.add(1, { result, environment: environment() })
  } catch (error) {
    logger.error('Failed to record person id drift metric', error)
  }
}

export function recordVoterDensityRequest(
  result: VoterDensityResult,
  durationMs: number,
): void {
  if (!isOtelEnabled()) return
  try {
    const attrs = { result, environment: environment() }
    voterDensityCounter.add(1, attrs)
    voterDensityDuration.record(durationMs, attrs)
  } catch (error) {
    logger.error('Failed to record voter density request metric', error)
  }
}
