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

// person_profile_completion_request_event_count_total{result=...}
const completionRequestEventCounter = meter.createCounter(
  'person_profile.completion_request_event.count',
  {
    description:
      'Segment "Person Profile - Completion Requested" emissions by result',
  },
)

// person_profile_completion_request_contact_gap_count_total{result=...}
const completionRequestContactGapCounter = meter.createCounter(
  'person_profile.completion_request_contact_gap.count',
  {
    description:
      'Sent completion-request events by whether HubSpot already held a contact for the subject',
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

// person_profile_voter_density_compare_count_total{result=...}
// Temporary: exists only for the people-db -> election-db migration window and
// is removed with the people-db leg.
const voterDensityCompareCounter = meter.createCounter(
  'person_profile.voter_density_compare.count',
  {
    description:
      'Agreement between the people-db and election-api voter-density sources by outcome',
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
 *  - no_contact: the person mart vouches that this person maps to no HubSpot
 *                contact — expected and common
 *  - unresolved: the mart was never asked (warehouse unconfigured), so the
 *                person's contact status is simply unknown this run
 *  - failed:     the warehouse lookup or the HubSpot write errored
 *
 * `no_contact` is the one to watch: a sustained 100% share means the person↔
 * contact linkage is unreachable, not that the counter is working.
 *
 * `no_contact` and `unresolved` were one value until the completion-request
 * event started reading this outcome. Both still mean "no count was written",
 * but only `no_contact` is evidence ABOUT the CRM, and the event half needs
 * that distinction to tell a contact Segment is about to create from a lookup
 * that never happened — see CompletionRequestContactGapResult below.
 */
export type ClaimRequestCrmSyncResult =
  | 'success'
  | 'skipped'
  | 'no_contact'
  | 'unresolved'
  | 'failed'

/**
 * Outcome of emitting the Segment event that triggers the "complete your
 * profile" nudge email:
 *  - sent:     the event went to Segment carrying the subject's email
 *  - no_email: election-api holds no address for this person, so the event was
 *              not sent — HubSpot could not route it to anyone
 *  - failed:   the lookup or the Segment call errored
 *
 * `no_email` is the share to watch, because it is the ceiling on how many of
 * these nudges can ever be delivered. It is a data-coverage number, not a
 * defect: it moves when the person feed gains addresses, not when this code
 * changes.
 */
export type CompletionRequestEventResult = 'sent' | 'no_email' | 'failed'

/**
 * For a completion-request event we DID send, whether HubSpot already held a
 * contact for the subject:
 *  - existing_contact: the person mart resolved an `hs_contact_id`, so the
 *                      event lands on a record that already existed
 *  - new_contact:      it did not, so Segment's cloud-mode destination creates
 *                      the contact
 *  - unknown:          contact status was not determined this run (HubSpot
 *                      unconfigured off-prod, or the warehouse lookup failed)
 *
 * `new_contact` is the population that costs us something irreversible: a
 * contact the Segment destination creates is attributed to HubSpot's offline
 * sources, and original source is immutable after creation, so if that person
 * later signs up through paid or organic their real attribution is already
 * gone. That trade is accepted — a nudge nobody can receive is worth less than
 * the attribution — but it is the number to check before widening this feature
 * or believing an acquisition report. See the HubSpot integration doc,
 * "Signup Attribution: Forms API with hutk", for why creation-time source
 * cannot be repaired afterwards.
 *
 * Only recorded when the event was actually sent: nothing is created in the CRM
 * for a submission that never emitted one.
 */
export type CompletionRequestContactGapResult =
  | 'existing_contact'
  | 'new_contact'
  | 'unknown'

/**
 * Outcome of a public voter-density proxy request:
 *  - live:        district resolved and cells returned
 *  - empty:       district resolved but upstream had no cells (low/no coverage)
 *  - no_district: person mapped to no L2 district (no map rendered)
 *  - error:       upstream (election-api / people-api) failure
 */
export type VoterDensityResult = 'live' | 'empty' | 'no_district' | 'error'

/**
 * Agreement between the two voter-density sources while the serving tables move
 * from people-db into election-db:
 *  - match:             both sides returned the same coverage and the same cells
 *  - cell_mismatch:     the cells differ in count, position, or voter count
 *  - coverage_mismatch: the cells agree but the coverage does not
 *  - only_legacy:       people-db has cells, election-api has none
 *  - only_new:          election-api has cells, people-db has none
 *  - error:             the shadow read threw, so there was nothing to compare
 *
 * `only_legacy` is the one that gates the cutover. During the window it is the
 * expected majority — it just means the data platform has not published that
 * district to election-db yet — so it must fall to zero before the flip, and it
 * is also exactly what an id-derivation mistake would look like. Separating it
 * from `cell_mismatch` is the whole point: "not loaded yet" and "loaded, and
 * wrong" need different responses and would otherwise be one number.
 */
export type VoterDensityCompareResult =
  | 'match'
  | 'cell_mismatch'
  | 'coverage_mismatch'
  | 'only_legacy'
  | 'only_new'
  | 'error'

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

export function recordCompletionRequestEvent(
  result: CompletionRequestEventResult,
): void {
  if (!isOtelEnabled()) return
  try {
    completionRequestEventCounter.add(1, {
      result,
      environment: environment(),
    })
  } catch (error) {
    logger.error('Failed to record completion request event metric', error)
  }
}

export function recordCompletionRequestContactGap(
  result: CompletionRequestContactGapResult,
): void {
  if (!isOtelEnabled()) return
  try {
    completionRequestContactGapCounter.add(1, {
      result,
      environment: environment(),
    })
  } catch (error) {
    logger.error(
      'Failed to record completion request contact gap metric',
      error,
    )
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

export function recordVoterDensityCompare(
  result: VoterDensityCompareResult,
): void {
  if (!isOtelEnabled()) return
  try {
    voterDensityCompareCounter.add(1, { result, environment: environment() })
  } catch (error) {
    logger.error('Failed to record voter density compare metric', error)
  }
}
