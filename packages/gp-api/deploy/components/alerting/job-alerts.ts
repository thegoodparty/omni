import { Alert } from './alerts.types'

/**
 * pg-boss dead letters, read from `pgboss_queue_jobs`, the gauge pg-boss
 * exports through OpenTelemetry. Every task reports the same counts, so each
 * queue takes the max across tasks before the sum. pg-boss's own internal
 * queues (`__pgboss__*`) do not end in `__dead` and are not counted.
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
    expr: 'sum(max by (messaging_destination_name) (pgboss_queue_jobs{service_name="gp-api", deployment_environment_name="$ENV", messaging_destination_name=~".+__dead", pgboss_job_state="ready"}))',
    threshold: 0,
    for: '5m',
    execErrState: 'KeepLast',
    message: [
      'A background job failed every retry and was moved to its dead-letter queue. Nothing will run it again until someone looks.',
      'To list, redrive or delete dead letters, see `packages/gp-api/src/jobs/AGENTS.md` § Dead letters.',
    ].join('\n\n'),
  },
]
