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
    // A paid P2P text purchase whose free-texts offer was redeemed by the
    // async Stripe webhook (POST /v1/payments/events) rather than the
    // browser-driven complete-checkout-session means the client dropped after
    // paying and never fired POST /outreach — so no Outreach row, Peerly job,
    // or Slack schedule was ever created. Healthy purchases always redeem via
    // complete-checkout-session / complete-free-purchase. See the campaign
    // 318735 incident (2026-07-01): money taken, nothing scheduled, and no
    // error logged because the request never arrived.
    expr: [
      'sum(count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      '|= "Free texts offer redeemed for campaign"',
      '| json',
      '| request_endpoint = "POST /v1/payments/events"',
      '[1h]))',
    ].join(' '),
    threshold: 0,
    for: '5m',
    message: [
      'A paid P2P outreach purchase was fulfilled by the Stripe webhook fallback in the last hour, which means the buyer likely paid but never completed campaign submission — no Peerly job or Slack schedule request would have been created.',
      'Click *View in Grafana* to find the log line and read the `campaign <id>` in the message. Then confirm in the DB whether an `outreach` row exists for that campaign: if none, the candidate paid with nothing scheduled and needs manual recovery/outreach.',
      'Note: this only catches free-texts-eligible purchases and can rarely false-positive when the webhook wins the completion race against a client that did finish — the DB check above disambiguates.',
    ].join('\n\n'),
    notify: 'win-bugs',
  },
  {
    slug: 'admin-impersonation-email-fallback-spike',
    name: '[Admin] Impersonation falling back to email actor',
    type: 'log',
    expr: 'sum(count_over_time({service_name="gp-api", deployment_environment_name="$ENV"} |= "Actor has no gp-api Clerk account" [15m]))',
    threshold: 5,
    for: '5m',
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
]
