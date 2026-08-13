import { ControllerName } from '../../src/generated/route-types'
import { Alert, SlackGroup } from './alerting/alerts.types'

/** Map of slack group to controllers */
export const ALERT_OWNERSHIP: Record<SlackGroup, ControllerName[]> = {
  'serve-bugs': [
    'elected-office',
    'polls',
    'contacts',
    'contact-engagement',
    'organizations',
  ],
  'win-bugs': [],
}

export const GLOBAL_ALERTS: Alert[] = [
  // ------ Global Shared Alerts ------ //
  {
    slug: 'high-cpu',
    name: 'High CPU utilization',
    type: 'metric',
    expr: 'avg(process_cpu_utilization{service_name="gp-api", deployment_environment_name="$ENV"}) * 100',
    threshold: 80,
    for: '5m',
    message: [
      'Process CPU utilization has exceeded 80% for 5 minutes.',
      'Click *View in Grafana* to check the CPU & Memory dashboard, and look for recent deployments or traffic spikes that may be driving the increase. If sustained, consider scaling up the service or profiling for hot code paths.',
    ].join('\n\n'),
  },
  {
    slug: 'high-memory',
    name: 'High memory utilization',
    type: 'metric',
    expr: 'avg(system_memory_utilization{service_name="gp-api", deployment_environment_name="$ENV", system_memory_state="used"}) * 100',
    threshold: 90,
    for: '5m',
    message: [
      'System memory utilization has exceeded 90% for 5 minutes.',
      'Click *View in Grafana* to check memory trends on the CPU & Memory dashboard. Look for memory leaks (steadily climbing usage) or a recent deployment that increased baseline consumption. If the service is at risk of OOM, consider restarting it and then investigating the root cause.',
    ].join('\n\n'),
  },
  {
    slug: 'health-check-probe-failure',
    name: 'Health check probe failures',
    type: 'metric',
    expr: '1 - (sum(rate(probe_all_success_sum{job="gp-api-$ENV-health"}[5m])) / sum(rate(probe_all_success_count{job="gp-api-$ENV-health"}[5m])))',
    threshold: 0.1,
    for: '2m',
    message:
      'Synthetic monitoring probes are failing against the health endpoint — the service may be unreachable externally.',
  },
  // ------ Serve Alerts ------ //
  {
    slug: 'serve-background-job-failed',
    name: '[Serve] Background job failed',
    type: 'log',
    // Poll-job failures only. The consumer logs the SQS message in
    // message_Body; match its `type` (pollCreation / pollExpansion /
    // pollAnalysisComplete) so sibling jobs that share the consumer (AI
    // content, websites) don't page the serve-bugs group.
    expr: 'sum(count_over_time({service_name="gp-api", deployment_environment_name="$ENV"} | json | context = "QueueConsumerService" | detected_level = "error" | message_Body =~ `"type":"poll.*` [5m]))',
    threshold: 0,
    for: '0m',
    message: [
      'A Serve-related background SQS job has failed in the last 5 minutes.',
      'Click *View in Grafana* to find the failing log lines, then check the associated error message and stack trace to understand what went wrong. Look at the SQS message payload to identify which job failed and whether it can be safely retried.',
    ].join('\n\n'),
    notify: 'serve-bugs',
  },
  // ------ Win Warnings ------ //
  {
    slug: 'win-peerly-warnings',
    name: '[Win] Peerly endpoint errors detected',
    type: 'log',
    expr: [
      'sum(count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      // Scope to genuine Peerly vendor API errors only. Keying off
      // request_endpoint matched every error logged during a p2p/tcr/outreach
      // request (LLM, election-api, etc.), not Peerly — 5/5 fires were collateral.
      '|= "Peerly API ERROR"',
      '| json',
      '| detected_level = "error"',
      '| context =~ "Peerly.+Service"',
      '[15m]))',
    ].join(' '),
    threshold: 0,
    for: '1m',
    // Explicitly pins the pre-timeRangeSeconds default. The 600s fetch caps
    // the [15m] vector to an effective 10-minute window; that has always been
    // this alert's firing behavior and is kept as-is — widening it would
    // lengthen re-firing after a transient error burst. Retune deliberately.
    timeRangeSeconds: 600,
    message: [
      'Peerly-related endpoint errors detected in the last 15 minutes.',
      'Dashboard: https://goodparty.grafana.net/d/peerly-prod/peerly-e28094-prod',
    ].join('\n\n'),
    notify: 'win-bugs',
  },
  {
    slug: 'win-outreach-paid-not-scheduled-warning',
    name: '[Win] P2P outreach paid but not scheduled',
    type: 'log',
    // Draft-first outreach: the campaign is persisted as a pending_payment
    // draft before checkout and finalized (Peerly + Slack) by the post-purchase
    // handler after payment. This fires when that finalize fails AFTER money
    // was taken — the row reverts to pending_payment and Stripe's webhook
    // retries. Successor to the campaign 318735 incident alert (2026-07-01),
    // which keyed off webhook-path free-texts redemption; that signal is
    // healthy behavior under draft-first (async payments and recovered
    // client drops finalize via webhook by design).
    expr: [
      'sum(count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      '|= "P2P outreach finalize failed after payment"',
      '[1h]))',
    ].join(' '),
    threshold: 0,
    for: '5m',
    // The [1h] range vector needs a matching fetch window; the default 600s
    // would let the engine see only 10 minutes of logs and miss this
    // low-frequency event.
    timeRangeSeconds: 3600,
    message: [
      'A paid P2P outreach draft failed to submit to Peerly in the last hour. Money was taken; the draft reverted to pending_payment and the Stripe webhook will retry automatically.',
      'Click *View in Grafana* to find the log line (search "P2P outreach finalize failed after payment") for the outreachId/campaignId and the underlying Peerly error. A CAS failure Slack message fires alongside this alert.',
      'If it keeps firing for the same outreach, retries are not self-healing — the draft row holds everything needed for manual submission (script, image URL, phone list, identity).',
    ].join('\n\n'),
    notify: 'win-bugs',
  },
  // ------ People (public profiles) ------ //
  {
    slug: 'people-profile-revalidation-failing',
    name: '[People] Public profile cache revalidation failing',
    type: 'metric',
    // person_profile.revalidation.count{result="failed"} — the outbound cache
    // bust to gp-marketing. Sustained failures mean publish/unpublish/delete
    // edits are live in gp-api but the public /people page stays stale until its
    // ISR window (1h) expires.
    expr: 'sum(rate(person_profile_revalidation_count_total{service_name="gp-api", deployment_environment_name="$ENV", result="failed"}[5m]))',
    threshold: 0,
    for: '10m',
    message: [
      'gp-api has been failing to revalidate public /people profile pages for 10 minutes.',
      'Owner edits (publish/unpublish/delete) are persisted but the cached marketing page will not refresh until its ISR window expires. Click *View in Grafana* (People Profiles dashboard), then check that MARKETING_REVALIDATE_SECRET matches gp-marketing and that POST $WEBAPP/api/revalidate-person is reachable and returns 200.',
    ].join('\n\n'),
  },
  {
    slug: 'admin-impersonation-email-fallback-spike',
    name: '[Admin] Impersonation falling back to email actor',
    type: 'log',
    expr: 'sum(count_over_time({service_name="gp-api", deployment_environment_name="$ENV"} |= "Actor has no gp-api Clerk account" [15m]))',
    threshold: 5,
    for: '5m',
    // Explicitly pins the pre-timeRangeSeconds default: effectively >5 events
    // per 10 minutes, this alert's firing behavior since it shipped. Kept
    // as-is; raising to 900 would make it more sensitive. Retune deliberately.
    timeRangeSeconds: 600,
    message: [
      'More than 5 admin impersonations have used the email-as-actor.sub fallback in the last 15 minutes.',
      "This means actorEmail lookups against gp-api's Clerk instance returned no match for those impersonation requests. Possible causes:",
      '  • Admins without a gp-api Clerk account are impersonating (a routine baseline may exist; we have not yet measured it)',
      '  • Email casing/format regression in gp-admin → SDK → controller',
      '  • Clerk lookup degraded or rate-limited',
      '  • Clerk has begun rejecting non-user_ actor.sub values',
      'Click *View in Grafana* to see the warn log lines (search "Actor has no gp-api Clerk account") and inspect the affected actorEmail values, then verify whether those admins exist in the gp-api Clerk instance.',
    ].join('\n\n'),
  },
  {
    slug: 'district-auto-match-no-district-spike',
    name: '[Serve] District auto-match: no-district spike',
    type: 'log',
    // Count of DISTINCT campaigns whose gold auto-match resolved a position but
    // found NO associated district in the last 6h. Keying off failureKind
    // isolates the *silent* failure mode (election-api returns a position with
    // no district, or a 404) from failureKind="error" (upstream 5xx), which
    // already pages via the per-route 5xx controller alerts — so this does not
    // double-alert on genuine election-api outages. The distinct-campaign count
    // dedupes a single campaign retrying (the place_id incident logged 30
    // retries from one position). Real no_match volume is ~0 in normal
    // operation, so a spike almost always means the position→district pipeline
    // (dbt mart / district association) broke without erroring.
    expr: [
      'count(sum by (campaignId) (count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      // Pin the cheap |= line filter before | json (as the sibling alerts do):
      // it narrows 6h of all gp-api logs down to the handful of DistrictMatch
      // events before the JSON parse, so the every-minute eval stays light and
      // can't time out into a false page (execErrState is Alerting).
      '|= "DistrictMatch"',
      '| json',
      '| event = "DistrictMatch"',
      '| failureKind = "no_match"',
      '[6h])))',
    ].join(' '),
    threshold: 5,
    for: '30m',
    // The [6h] range vector needs a matching fetch window; the default 600s
    // would let the engine see only 10 minutes of logs and never accumulate
    // the 6h count this alert is built on.
    timeRangeSeconds: 21600,
    message: [
      'More than 5 distinct campaigns hit a "no matched district" outcome in the last 6h — well above the ~0 baseline.',
      'This usually means the auto-district-matching pipeline broke *silently*: election-api is returning a position with no associated district (or a 404) rather than an error. Likely causes: a district-association / dbt mart regression, or an election-api data/deploy issue that stopped attaching districts. Note that upstream election-api errors (5xx) are excluded here — those page via the per-route error alerts instead.',
      'Click *View in Grafana* to see the failure logs (event="DistrictMatch", failureKind="no_match"), then inspect the affected positionId / ballotreadyPositionId values and confirm whether election-api is still returning districts for them.',
    ].join('\n\n'),
    notify: 'serve-bugs',
  },
]
