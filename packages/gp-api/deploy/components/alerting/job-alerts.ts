import { Alert } from './alerts.types'

/**
 * pg-boss dead letters, read from the `GpApi/Jobs` `DeadLetterJobs` metric
 * gp-api publishes every minute from each task. Every task publishes the same
 * count, so the rule reads Maximum.
 *
 * Absence is healthy: the app publishes only on dev and prod, and
 * `noDataState: OK` (grafana.ts) keeps a gap quiet. A query that cannot run
 * keeps the last real answer through `execErrState: KeepLast`;
 * `alerting-rule-evaluations-failing` reports a broken query path.
 */
export const jobAlerts: Alert[] = [
  {
    slug: 'jobs-dead-letter',
    name: 'Background jobs in a dead-letter queue',
    type: 'cloudwatch',
    cloudwatchNamespace: 'GpApi/Jobs',
    cloudwatchDimensions: { Environment: '$ENV' },
    cloudwatchStatistic: 'Maximum',
    expr: 'DeadLetterJobs',
    threshold: 0,
    for: '5m',
    execErrState: 'KeepLast',
    message: [
      'A background job failed every retry and was moved to its dead-letter queue. Nothing will run it again until someone looks.',
      'To list, redrive or delete dead letters, see `packages/gp-api/src/jobs/AGENTS.md` § Dead letters.',
    ].join('\n\n'),
  },
]
