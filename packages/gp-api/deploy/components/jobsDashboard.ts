// Dashboard-as-code for pg-boss background jobs (src/jobs/). Every queue
// shows up through the queue variable, with no per-job setup. pg-boss's
// OpenTelemetry metrics label the queue `messaging_destination_name`;
// JobsService's own gauges label it `queue`. Every task reports the same
// queue gauges, so they are combined with max, never sum.
export interface JobsDashboardConfig {
  environment: 'dev' | 'prod'
  promDatasourceUid: string
}

export const jobsDashboardConfigJson = ({
  environment,
  promDatasourceUid,
}: JobsDashboardConfig): string => {
  const labels = 'service_name="gp-api", deployment_environment_name="$env"'
  const queues = `${labels}, messaging_destination_name=~"$queue"`
  const ds = { type: 'prometheus', uid: promDatasourceUid }

  return JSON.stringify({
    title: `gp-api ${environment} - background jobs`,
    uid: `gp-api-${environment}-background-jobs`,
    editable: true,
    timezone: 'browser',
    time: { from: 'now-24h', to: 'now' },
    refresh: '1m',
    templating: {
      list: [
        {
          name: 'env',
          label: 'Environment',
          type: 'custom',
          query: 'preview,dev,prod',
          current: { text: environment, value: environment },
          options: ['preview', 'dev', 'prod'].map((value) => ({
            text: value,
            value,
            selected: value === environment,
          })),
        },
        {
          name: 'queue',
          label: 'Queue',
          type: 'query',
          datasource: ds,
          query: {
            query: `label_values(pgboss_queue_jobs{${labels}, messaging_destination_name!~"__pgboss__.*|.+-dlq"}, messaging_destination_name)`,
            refId: 'queue',
          },
          definition: `label_values(pgboss_queue_jobs{${labels}, messaging_destination_name!~"__pgboss__.*|.+-dlq"}, messaging_destination_name)`,
          refresh: 2,
          sort: 1,
          multi: true,
          includeAll: true,
          current: { text: ['All'], value: ['$__all'] },
        },
      ],
    },
    panels: [
      {
        id: 1,
        title: 'Jobs sent per minute',
        description: 'Jobs added to each queue.',
        type: 'timeseries',
        gridPos: { h: 9, w: 12, x: 0, y: 0 },
        datasource: ds,
        targets: [
          {
            expr: `sum by (messaging_destination_name) (rate(messaging_client_sent_messages_total{${queues}}[5m])) * 60`,
            legendFormat: '{{messaging_destination_name}}',
            refId: 'A',
          },
        ],
        fieldConfig: {
          defaults: {
            unit: 'opm',
            min: 0,
            custom: { fillOpacity: 10, lineWidth: 2 },
          },
          overrides: [],
        },
      },
      {
        id: 2,
        title: 'Jobs processed and failed attempts per minute',
        description:
          'Attempts that finished, split into succeeded and failed. ' +
          'A failed attempt is retried until the job runs out of retries.',
        type: 'timeseries',
        gridPos: { h: 9, w: 12, x: 12, y: 0 },
        datasource: ds,
        targets: [
          {
            expr: `sum by (messaging_destination_name) (rate(messaging_process_duration_seconds_count{${queues}, error_type=""}[5m])) * 60`,
            legendFormat: '{{messaging_destination_name}} processed',
            refId: 'A',
          },
          {
            expr: `sum by (messaging_destination_name) (rate(messaging_process_duration_seconds_count{${queues}, error_type!=""}[5m])) * 60`,
            legendFormat: '{{messaging_destination_name}} failed',
            refId: 'B',
          },
        ],
        fieldConfig: {
          defaults: {
            unit: 'opm',
            min: 0,
            custom: { fillOpacity: 10, lineWidth: 2 },
          },
          overrides: [
            {
              matcher: { id: 'byRegexp', options: '/ failed$/' },
              properties: [
                { id: 'color', value: { mode: 'fixed', fixedColor: 'red' } },
              ],
            },
          ],
        },
      },
      {
        id: 3,
        title: 'Failure rate',
        description: 'Failed attempts as a share of all attempts.',
        type: 'timeseries',
        gridPos: { h: 9, w: 12, x: 0, y: 9 },
        datasource: ds,
        targets: [
          {
            expr: `100 * (sum by (messaging_destination_name) (rate(messaging_process_duration_seconds_count{${queues}, error_type!=""}[5m])) or 0 * sum by (messaging_destination_name) (rate(messaging_process_duration_seconds_count{${queues}}[5m]))) / sum by (messaging_destination_name) (rate(messaging_process_duration_seconds_count{${queues}}[5m]))`,
            legendFormat: '{{messaging_destination_name}}',
            refId: 'A',
          },
        ],
        fieldConfig: {
          defaults: {
            unit: 'percent',
            min: 0,
            max: 100,
            custom: { fillOpacity: 10, lineWidth: 2 },
          },
          overrides: [],
        },
      },
      {
        id: 4,
        title: 'Run time (p50 / p95)',
        description: 'How long each attempt ran, failed attempts included.',
        type: 'timeseries',
        gridPos: { h: 9, w: 12, x: 12, y: 9 },
        datasource: ds,
        targets: [
          {
            expr: `histogram_quantile(0.50, sum by (le, messaging_destination_name) (rate(messaging_process_duration_seconds_bucket{${queues}}[5m])))`,
            legendFormat: '{{messaging_destination_name}} p50',
            refId: 'A',
          },
          {
            expr: `histogram_quantile(0.95, sum by (le, messaging_destination_name) (rate(messaging_process_duration_seconds_bucket{${queues}}[5m])))`,
            legendFormat: '{{messaging_destination_name}} p95',
            refId: 'B',
          },
        ],
        fieldConfig: {
          defaults: {
            unit: 's',
            min: 0,
            custom: { fillOpacity: 10, lineWidth: 2 },
          },
          overrides: [],
        },
      },
      {
        id: 5,
        title: 'Jobs by state',
        description:
          'Jobs in each queue by pg-boss state: ready, active, deferred ' +
          '(scheduled or waiting on a retry), blocked and failed.',
        type: 'timeseries',
        gridPos: { h: 9, w: 12, x: 0, y: 18 },
        datasource: ds,
        targets: [
          {
            expr: `max by (messaging_destination_name, pgboss_job_state) (pgboss_queue_jobs{${queues}})`,
            legendFormat: '{{messaging_destination_name}} {{pgboss_job_state}}',
            refId: 'A',
          },
        ],
        fieldConfig: {
          defaults: {
            unit: 'short',
            min: 0,
            custom: { fillOpacity: 10, lineWidth: 2 },
          },
          overrides: [],
        },
      },
      {
        id: 6,
        title: 'Oldest ready job age vs limit',
        description:
          'How long the oldest ready job has waited. Past the dashed ' +
          'limit (alertAfterWaitingMinutes) the jobs-backed-up alert fires.',
        type: 'timeseries',
        gridPos: { h: 9, w: 12, x: 12, y: 18 },
        datasource: ds,
        targets: [
          {
            expr: `max by (queue) (jobs_ready_oldest_seconds{${labels}, queue=~"$queue"})`,
            legendFormat: '{{queue}} oldest',
            refId: 'A',
          },
          {
            expr: `max by (queue) (jobs_max_wait_seconds{${labels}, queue=~"$queue"})`,
            legendFormat: '{{queue}} limit',
            refId: 'B',
          },
        ],
        fieldConfig: {
          defaults: {
            unit: 's',
            min: 0,
            custom: { fillOpacity: 10, lineWidth: 2 },
          },
          overrides: [
            {
              matcher: { id: 'byRegexp', options: '/ limit$/' },
              properties: [
                {
                  id: 'custom.lineStyle',
                  value: { fill: 'dash', dash: [10, 10] },
                },
                { id: 'custom.fillOpacity', value: 0 },
              ],
            },
          ],
        },
      },
      {
        id: 7,
        title: 'Dead letters',
        description:
          'Jobs that ran out of retries, per dead-letter queue. Handle ' +
          'them with scripts/jobs-dead-letter.ts.',
        type: 'timeseries',
        gridPos: { h: 9, w: 24, x: 0, y: 27 },
        datasource: ds,
        targets: [
          {
            expr: `max by (messaging_destination_name) (pgboss_queue_jobs{${labels}, messaging_destination_name=~"$queue-dlq", pgboss_job_state="ready"})`,
            legendFormat: '{{messaging_destination_name}}',
            refId: 'A',
          },
        ],
        fieldConfig: {
          defaults: {
            unit: 'short',
            min: 0,
            custom: { fillOpacity: 10, lineWidth: 2 },
          },
          overrides: [],
        },
      },
    ],
  })
}
