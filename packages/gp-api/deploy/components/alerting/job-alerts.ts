import { Alert } from './alerts.types'

const STREAM = '{service_name="gp-api", deployment_environment_name="$ENV"}'

/**
 * pg-boss queue health, read from the lines JobsService logs. Both are event
 * rules (see EVENT RULES above GLOBAL_ALERTS in alerts.ts): a [1m] window
 * every minute, 30 seconds behind, so each line is read once. Each queue is
 * its own alert instance, labelled `queue`. The rules are grouped, so like
 * queue-message-discarded they carry no `keepFiringFor`, and the
 * notification policy groups by `queue` so a second queue gets its own
 * notification instead of joining the first queue's group and going out
 * only as resolved.
 */
export const jobAlerts: Alert[] = [
  {
    slug: 'jobs-dead-letter',
    name: 'Background job dead-lettered',
    type: 'log',
    // The last attempt failed: JobsService logs this once per job as pg-boss
    // moves it to `<name>-dlq`. `job` renamed to `queue` so both job rules
    // carry the same label.
    expr: [
      'sum by (queue) (count_over_time(',
      STREAM,
      '|= "job dead-lettered" | context = "JobsService"',
      '| label_format queue=job | keep queue',
      '[1m]))',
    ].join(' '),
    threshold: 0,
    for: '0m',
    timeRangeSeconds: 60,
    timeRangeOffsetSeconds: 30,
    summaryDetail: '`{{ $labels.queue }}`',
    message: [
      'A `{{ $labels.queue }}` job failed every attempt and was moved to `{{ $labels.queue }}-dlq`, in the 60 seconds ending 30 seconds before this check. Nothing will run it again until someone looks. This alert resolves on its own; the dead letter stays for 14 days.',
      'Click *View in Grafana* and search "job dead-lettered": the line carries the `jobId`, the `data` and the last `err`. To list, redrive or delete dead letters, see `packages/gp-api/src/jobs/AGENTS.md` § Dead letters.',
    ].join('\n\n'),
  },
  {
    slug: 'jobs-backed-up',
    name: 'Background job queue backed up',
    type: 'log',
    // One gp-api task logs this once a minute for each queue whose oldest
    // ready job has waited longer than its alertAfterWaitingMinutes
    // (JobsService.reportQueues). Grafana resolves an instance only after
    // two evaluations without its series, so a window the line misses by a
    // few seconds does not resolve it while the queue stays backed up.
    expr: [
      'sum by (queue) (count_over_time(',
      STREAM,
      '|= "job queue backed up" | context = "JobsService"',
      '| keep queue',
      '[1m]))',
    ].join(' '),
    threshold: 0,
    for: '0m',
    timeRangeSeconds: 60,
    timeRangeOffsetSeconds: 30,
    summaryDetail: '`{{ $labels.queue }}`',
    message: [
      'The oldest ready job in `{{ $labels.queue }}` has waited longer than its `alertAfterWaitingMinutes` (`packages/gp-api/src/jobs/jobs.registry.ts`). Workers are not keeping up, or not running.',
      'Click *View in Grafana* and search "job queue backed up" for `waitedSeconds`. Then search the logs for this queue: `job started` shows whether workers are taking jobs at all, `job attempt failed` whether they are failing. Check the gp-api task count. One group runs one job at a time, so a group with a slow or retrying job backs up behind it.',
    ].join('\n\n'),
  },
]
