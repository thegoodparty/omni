import { Alert } from './alerts.types'

const SELECTOR = 'service_name="gp-api", deployment_environment_name="$ENV"'

/**
 * pg-boss queue health, from gauges every gp-api task exports through
 * OpenTelemetry. Every task reports the same numbers, so each rule takes the
 * max per queue, and each queue is its own alert instance. Both conditions
 * hold until someone acts, so a second queue joining an already-notified
 * group goes out at the next group interval as firing; no `keepFiringFor`
 * or policy `group_by` change is needed.
 *
 * A query that cannot run keeps the last real answer through
 * `execErrState: KeepLast`; `alerting-rule-evaluations-failing` reports a
 * broken query path.
 */
export const jobAlerts: Alert[] = [
  {
    slug: 'jobs-dead-letter',
    name: 'Background jobs in a dead-letter queue',
    type: 'metric',
    // pg-boss's own gauge. Its internal queues (`__pgboss__*`) do not end in
    // `-dlq`.
    expr: `max by (messaging_destination_name) (pgboss_queue_jobs{${SELECTOR}, messaging_destination_name=~".+-dlq", pgboss_job_state="ready"})`,
    threshold: 0,
    for: '5m',
    execErrState: 'KeepLast',
    summaryDetail: '`{{ $labels.messaging_destination_name }}`',
    message: [
      'A job in `{{ $labels.messaging_destination_name }}` failed every retry and was moved to its dead-letter queue. Nothing will run it again until someone looks.',
      'To list, redrive or delete dead letters, see `packages/gp-api/src/jobs/AGENTS.md` § Dead letters.',
    ].join('\n\n'),
  },
  {
    slug: 'jobs-backed-up',
    name: 'Background job queue backed up',
    type: 'metric',
    // Over 1 when the oldest ready job has waited longer than its job's
    // maxWaitSeconds in the registry. JobsService exports both gauges.
    expr: `max by (queue) (jobs_ready_oldest_seconds{${SELECTOR}}) / max by (queue) (jobs_max_wait_seconds{${SELECTOR}})`,
    threshold: 1,
    for: '5m',
    execErrState: 'KeepLast',
    summaryDetail: '`{{ $labels.queue }}`',
    message: [
      'The oldest ready job in `{{ $labels.queue }}` has waited longer than its `maxWaitSeconds` (`packages/gp-api/src/jobs/jobs.registry.ts`). Workers are not keeping up, or not running.',
      'Click *View in Grafana*: `pgboss_queue_jobs` for this queue shows whether jobs are active (slow workers) or none are (stopped workers). Check the gp-api task count and the `job failed` logs. A queue with `groupConcurrency` can back up behind one busy group.',
    ].join('\n\n'),
  },
]
