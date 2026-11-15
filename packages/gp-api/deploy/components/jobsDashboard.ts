// Dashboard-as-code for pg-boss background jobs (src/jobs/). Every queue
// shows up through the queue variable, with no per-job setup. Volume,
// failures and run time come from the span metrics Grafana derives from
// pg-boss's `process <queue>` and `send <queue>` spans. Those carry no
// environment label, so each query joins `target_info` on `instance` to
// keep one environment. Wait pressure is JobsService's own gauge, which one
// task per environment reports.
export interface JobsDashboardConfig {
  environment: 'dev' | 'prod'
  promDatasourceUid: string
}

export const jobsDashboardConfigJson = ({
  environment,
  promDatasourceUid,
}: JobsDashboardConfig): string => {
  const ds = { type: 'prometheus', uid: promDatasourceUid }
  const inEnv =
    '* on (instance) group_left() target_info{service_name="gp-api", deployment_environment_name="$env"}'
  const spans = (operation: string, extra = '') =>
    `service="gp-api", span_name=~"${operation} ($queue)", span_name!~".* __pgboss__.*"${extra}`
  const perMinute = (selector: string) =>
    `sum by (span_name) (rate(traces_spanmetrics_calls_total{${selector}}[5m]) ${inEnv}) * 60`
  const runTime = (quantile: number) =>
    `histogram_quantile(${quantile}, sum by (le, span_name) (rate(traces_spanmetrics_latency_bucket{${spans('process')}}[5m]) ${inEnv}))`
  const failed = ', status_code="STATUS_CODE_ERROR"'
  const succeeded = ', status_code!="STATUS_CODE_ERROR"'

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
            query:
              'label_values(traces_spanmetrics_calls_total{service="gp-api", span_name=~"process .*", span_name!~".* __pgboss__.*"}, span_name)',
            refId: 'queue',
          },
          definition:
            'label_values(traces_spanmetrics_calls_total{service="gp-api", span_name=~"process .*", span_name!~".* __pgboss__.*"}, span_name)',
          regex: '/^process (.+)$/',
          refresh: 2,
          sort: 1,
          multi: true,
          includeAll: true,
          allValue: '.+',
          current: { text: ['All'], value: ['$__all'] },
        },
      ],
    },
    panels: [
      {
        id: 1,
        title: 'Sends per minute',
        description:
          'send() calls per queue. A sendMany() is one call per chunk of ' +
          'up to 1,000 jobs, so this counts calls, not jobs.',
        type: 'timeseries',
        gridPos: { h: 9, w: 12, x: 0, y: 0 },
        datasource: ds,
        targets: [
          {
            expr: perMinute(spans('(send|insert)')),
            legendFormat: '{{span_name}}',
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
            expr: perMinute(spans('process', succeeded)),
            legendFormat: '{{span_name}} succeeded',
            refId: 'A',
          },
          {
            expr: perMinute(spans('process', failed)),
            legendFormat: '{{span_name}} failed',
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
            expr: `100 * (${perMinute(spans('process', failed))} or 0 * ${perMinute(spans('process'))}) / ${perMinute(spans('process'))}`,
            legendFormat: '{{span_name}}',
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
        description:
          'How long each attempt ran, failed attempts included. The span ' +
          'metric buckets stop at 10 seconds, so anything slower reads as ' +
          'over 10s.',
        type: 'timeseries',
        gridPos: { h: 9, w: 12, x: 12, y: 9 },
        datasource: ds,
        targets: [
          {
            expr: runTime(0.5),
            legendFormat: '{{span_name}} p50',
            refId: 'A',
          },
          {
            expr: runTime(0.95),
            legendFormat: '{{span_name}} p95',
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
        title: 'Wait pressure',
        description:
          'How long the oldest job a free worker could start has waited, ' +
          'over alertAfterWaitingMinutes. Jobs held behind their group ' +
          'do not count. Dev and prod add tasks from 0.5. Dev and prod only.',
        type: 'timeseries',
        gridPos: { h: 9, w: 24, x: 0, y: 18 },
        datasource: ds,
        targets: [
          {
            expr: 'max by (queue) (jobs_wait_pressure{service_name="gp-api", deployment_environment_name="$env", queue=~"$queue"})',
            legendFormat: '{{queue}}',
            refId: 'A',
          },
        ],
        fieldConfig: {
          defaults: {
            unit: 'short',
            min: 0,
            custom: {
              fillOpacity: 10,
              lineWidth: 2,
              thresholdsStyle: { mode: 'dashed' },
            },
            thresholds: {
              mode: 'absolute',
              steps: [
                { color: 'green', value: null },
                { color: 'orange', value: 0.5 },
                { color: 'red', value: 1 },
              ],
            },
          },
          overrides: [],
        },
      },
    ],
  })
}
