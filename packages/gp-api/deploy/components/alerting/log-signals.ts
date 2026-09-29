import { RecordingRule } from './alerts.types'

/**
 * One log-derived number, counted once a minute and written to Prometheus.
 *
 * WHY EVERY GLOBAL ALERT NOW GOES THROUGH ONE OF THESE. A Loki-backed alert
 * re-reads its whole fetch window on every evaluation, so what it costs per day
 * is `window ÷ interval` times the volume of the stream it selects. The plan
 * includes log queries up to 100x ingest, and on 2026-09-29 the hand-written
 * global alerts were budgeted at 787x between them and measured at 4.4x the
 * allowance with production perfectly healthy.
 *
 * Moving the five door-knocking spend rules onto a recorded metric dropped that
 * to 612 GB/day against a 1,056 GB/day allowance — and then the morning traffic
 * ramp took it back over 2.8x by 10:30 UTC without a single rule changing.
 * THAT is the part worth writing down: **the ratio is not scale-invariant.** A
 * rule's cost scales with the volume of `{service_name="gp-api",
 * deployment_environment_name="prod"}`, while the allowance scales with total
 * account ingest — gp-api prod, gp-api dev, election-api and everything else.
 * gp-api prod is a small share of that overnight and a large one at midday
 * (67.8 MB/h at 07:30 UTC, 281 MB/h at 09:30), so the same rules cost 3.5x more
 * of the allowance at peak. Any budget expressed in `window ÷ interval` has to
 * be set against the peak, and even then it drifts as traffic grows.
 *
 * The way out is not a tighter budget, it is to stop re-reading. A signal here
 * reads one minute of logs once a minute — the floor, 1x ingest, and the only
 * cost that does not grow when an alert's window widens or its interval
 * shortens. The alert then assembles whatever window it wants in PromQL, which
 * is not metered by bytes, and keeps its 60-second evaluation cadence: unlike
 * slowing an interval, this costs no detection latency at all.
 *
 * The conversion is exactly equivalent, which is why it is safe to do in bulk:
 * `count_over_time` over N minutes is the sum of N one-minute counts, and a
 * ratio of two sums is the ratio it always was.
 */
type LogSignal = {
  /** Unique slug. Used for the Pulumi resource name and the Grafana uid. */
  slug: string
  /** Shown in Grafana, prefixed with the environment by `grafana.ts`. */
  name: string
  /** The Prometheus series this writes. */
  metric: string
  /**
   * The LogQL pipeline between the stream selector and the range vector, as
   * the lines it is built from.
   *
   * A cheap `|=` line filter comes first wherever one exists, before any
   * `| json`: the parser runs per line on everything the selector returned, so
   * narrowing first is what keeps a parse off 300,000 lines an hour. The bytes
   * are the same either way — that part is about CPU and about an evaluation
   * that cannot time out into a false page, since `execErrState` is `Alerting`.
   *
   * AND NO `| json` FOR A FIELD THAT IS ALREADY A LABEL. Grafana Cloud promotes
   * OTel log-record attributes to structured metadata, so `request_endpoint`,
   * `response_statusCode` and `responseTimeMs` are labels before any parser
   * runs; a `| json` naming them collides and Loki renames its output to
   * `*_extracted`, which means the filter was reading the metadata all along
   * and the parser only added a per-line label for every field in the body.
   * The alerts these signals replaced all carried one. Re-verified against prod
   * on 2026-09-29: the profile denominator returns the identical four series
   * with and without it. Keep the parser only for a field that really is
   * body-only — `event`, `context`, `message_Body`, `credits`.
   */
  pipeline: string[]
  /**
   * The label to split the count by, for a signal whose alert pages per
   * dimension. Omitted for a signal that is one number.
   *
   * `| keep` is what makes this safe rather than merely correct: structured
   * metadata carries `requestId`, `trace_id` and `span_id`, all unique per
   * request, and they are part of the identity of the vector `count_over_time`
   * counts. Without it the inner vector is about one series per log line and
   * the query fails outright past 500 series. With it, it is bounded by the
   * number of distinct values of this one label.
   */
  groupBy?: string
}

const STREAM = '{service_name="gp-api", deployment_environment_name="$ENV"}'

/**
 * A one-minute count recorded every minute — a 1:1 window-to-interval ratio, so
 * each log line is read exactly once. This is the floor and there is no reason
 * for any signal here to sit above it.
 */
const SIGNAL_WINDOW = '1m'
const SIGNAL_INTERVAL_SECONDS = 60

/**
 * The window ends 60s before now, for the reason ROUTE_RECORDING_LAG_SECONDS
 * gives in controller-alerts.ts: a log line reaches Loki several seconds after
 * the request it describes, and a window ending at `now` misses the newest lines
 * permanently, because the next window starts where this one ended. Reading a
 * window that has already closed costs exactly the same.
 */
const SIGNAL_LAG_SECONDS = 60

const SIGNALS: LogSignal[] = [
  {
    slug: 'queue-poll-job-failures',
    name: 'gp-api Serve poll job failures per minute',
    metric: 'gp_api:queue_poll_job_failures:count1m',
    // Poll-job failures only. The consumer logs the SQS message in
    // message_Body; match its `type` (pollCreation / pollExpansion /
    // pollAnalysisComplete) so sibling jobs that share the consumer (AI
    // content, websites) don't page the serve-bugs group.
    pipeline: [
      '| json',
      '| context = "QueueConsumerService"',
      '| detected_level = "error"',
      '| message_Body =~ `"type":"poll.*`',
    ],
  },
  {
    slug: 'peerly-api-errors',
    name: 'gp-api Peerly API errors per minute',
    metric: 'gp_api:peerly_api_errors:count1m',
    // Scope to genuine Peerly vendor API errors only. Keying off
    // request_endpoint matched every error logged during a p2p/tcr/outreach
    // request (LLM, election-api, etc.), not Peerly — 5/5 fires were collateral.
    pipeline: [
      '|= "Peerly API ERROR"',
      '| json',
      '| detected_level = "error"',
      '| context =~ "Peerly.+Service"',
    ],
  },
  {
    slug: 'p2p-finalize-after-payment-failures',
    name: 'gp-api P2P finalize-after-payment failures per minute',
    metric: 'gp_api:p2p_finalize_after_payment_failures:count1m',
    pipeline: ['|= "P2P outreach finalize failed after payment"'],
  },
  {
    slug: 'robocall-critical-events',
    name: 'gp-api robocall CRITICAL events per minute',
    metric: 'gp_api:robocall_critical_events:count1m',
    pipeline: ['|= "CRITICAL robocall"'],
  },
  {
    slug: 'door-knocking-pack-build-failures',
    name: 'gp-api door-knocking pack build failures per minute',
    metric: 'gp_api:door_knocking_pack_build_failures:count1m',
    pipeline: [
      '|= "DoorKnockingPackBuildFailed"',
      '| json',
      '| event = "DoorKnockingPackBuildFailed"',
    ],
  },
  {
    slug: 'person-contact-email-lookup-failures',
    name: 'gp-api person contact email lookup failures per minute',
    metric: 'gp_api:person_contact_email_lookup_failures:count1m',
    pipeline: ['|= "Person contact email lookup failed"'],
  },
  {
    slug: 'person-id-repoint-collisions',
    name: 'gp-api person_id repoint collisions per minute',
    metric: 'gp_api:person_id_repoint_collisions:count1m',
    // The two ways `resyncLinkedUser` abandons a repoint and leaves it for a
    // human. The other three outcomes fix themselves on the next sweep, and
    // paging on those is how this signal would get muted.
    pipeline: [
      '|= "person_id"',
      '|~ "destination id is already occupied|lost a race to a concurrent write"',
    ],
  },
  {
    slug: 'impersonation-email-fallback',
    name: 'gp-api impersonation email-actor fallbacks per minute',
    metric: 'gp_api:impersonation_email_fallback:count1m',
    pipeline: ['|= "Actor has no gp-api Clerk account"'],
  },
  {
    slug: 'public-campaign-lookup-errors',
    name: 'gp-api public campaign lookup server errors per minute',
    metric: 'gp_api:public_campaign_lookup_errors:count1m',
    pipeline: [
      '|= "Request completed"',
      '| request_endpoint = "GET /v1/public-campaigns"',
      '| response_statusCode >= 500',
    ],
  },
  {
    slug: 'public-campaign-lookups-resolvable',
    name: 'gp-api public campaign lookups that should resolve, per minute',
    metric: 'gp_api:public_campaign_lookups_resolvable:count1m',
    // 404 is this route's answer for "this candidate has not claimed a
    // profile" and is ~95% of its traffic. In the denominator it dilutes a
    // total outage down to single-digit percent.
    pipeline: [
      '|= "Request completed"',
      '| request_endpoint = "GET /v1/public-campaigns"',
      '| response_statusCode != 404',
    ],
  },
  {
    slug: 'public-person-profile-errors',
    name: 'gp-api public person profile failures per minute',
    metric: 'gp_api:public_person_profile_errors:count1m',
    // A null status is the absence of one, so `>= 500` misses the worst answer
    // a route can give: a request the gateway killed before it answered.
    pipeline: [
      '|= "Request completed"',
      '| request_endpoint =~ `^[A-Z]+ /v1/public-person-profiles(/.*)?$`',
      '| ( response_statusCode >= 500 ) or ( response_statusCode = "" )',
    ],
    groupBy: 'request_endpoint',
  },
  {
    slug: 'public-person-profile-lookups-resolvable',
    name: 'gp-api public person profile lookups that should resolve, per minute',
    metric: 'gp_api:public_person_profile_lookups_resolvable:count1m',
    // A killed request counts as traffic as well as as a failure. Failures
    // that are not also traffic push the ratio above 100% during a pure
    // timeout wave, and leave the volume floor guarding a smaller population
    // than the ratio it qualifies.
    pipeline: [
      '|= "Request completed"',
      '| request_endpoint =~ `^[A-Z]+ /v1/public-person-profiles(/.*)?$`',
      '| ( response_statusCode != 404 ) or ( response_statusCode = "" )',
    ],
    groupBy: 'request_endpoint',
  },
]

const signalExpr = (signal: LogSignal) => {
  const aggregation = signal.groupBy ? `sum by (${signal.groupBy})` : 'sum'
  const keep = signal.groupBy ? [`| keep ${signal.groupBy}`] : []

  return [
    `${aggregation} (count_over_time(`,
    STREAM,
    ...signal.pipeline,
    ...keep,
    `[${SIGNAL_WINDOW}]))`,
  ].join(' ')
}

const byMetric = new Map(SIGNALS.map((signal) => [signal.metric, signal]))

const signal = (metric: string) => {
  const found = byMetric.get(metric)
  if (!found) throw new Error(`no log signal writes ${metric}`)
  return found
}

/** The recording rules that write every signal above. */
export const LOG_SIGNAL_RECORDING_RULES: RecordingRule[] = SIGNALS.map(
  (entry) => ({
    slug: entry.slug,
    name: entry.name,
    metric: entry.metric,
    expr: signalExpr(entry),
    fromSeconds: SIGNAL_LAG_SECONDS + 60,
    toSeconds: SIGNAL_LAG_SECONDS,
    intervalSeconds: SIGNAL_INTERVAL_SECONDS,
  }),
)

/**
 * The LogQL behind a signal, for the tests that assert on what an alert counts.
 *
 * Those assertions are the reason several of these rules are trustworthy — that
 * the repoint signal catches both ways a repoint is abandoned and neither way it
 * retries itself, that the profile ratio counts a request killed mid-flight as
 * both a failure and traffic. Moving the query out of the alert must not move
 * them out of the suite, so this is how they still reach it.
 */
export const logSignalExpr = (metric: string) => signalExpr(signal(metric))

/** Total count of a signal over `window`. */
export const logSignalTotal = (metric: string, window: string) =>
  `sum_over_time(${metric}{environment="$ENV"}[${window}])`

/**
 * Total count of a signal over `window`, split by the label it is grouped by.
 *
 * Grafana turns each returned series into its own alert instance, so this is
 * what keeps a per-route alert per-route: a route that is entirely broken is
 * judged on its own numbers rather than averaged out by a busier sibling that
 * is fine.
 */
export const logSignalTotalBy = (metric: string, window: string) => {
  const { groupBy } = signal(metric)
  if (!groupBy) throw new Error(`${metric} is not grouped`)

  return `sum by (${groupBy}) (${logSignalTotal(metric, window)})`
}
