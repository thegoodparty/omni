// Dashboard-as-code for the public /people profiles feature. Panels are driven
// by the custom OTel metrics emitted from
// src/personProfiles/observability/person-profiles.metrics.ts. Metric names are
// the Prometheus form produced by the Grafana Cloud OTLP gateway (dots ->
// underscores, counters get a _total suffix, the ms histogram gets
// _milliseconds_{bucket,sum,count}).
export interface PersonProfilesDashboardConfig {
  environment: 'dev' | 'prod'
  promDatasourceUid: string
}

export function personProfilesDashboardConfigJson({
  environment,
  promDatasourceUid,
}: PersonProfilesDashboardConfig): string {
  const labels = `service_name="gp-api", deployment_environment_name="${environment}"`
  const ds = { type: 'prometheus', uid: promDatasourceUid }

  return JSON.stringify({
    title: `gp-api ${environment} - People Profiles`,
    uid: `gp-api-${environment}-people-profiles`,
    editable: true,
    timezone: 'browser',
    time: { from: 'now-24h', to: 'now' },
    refresh: '1m',
    panels: [
      {
        id: 1,
        title: 'Public profile requests by result (rate)',
        type: 'timeseries',
        gridPos: { h: 9, w: 12, x: 0, y: 0 },
        datasource: ds,
        targets: [
          {
            expr: `sum by (result) (rate(person_profile_public_request_count_total{${labels}}[5m]))`,
            legendFormat: '{{result}}',
            refId: 'A',
          },
        ],
        fieldConfig: {
          defaults: {
            unit: 'reqps',
            min: 0,
            custom: { fillOpacity: 10, lineWidth: 2 },
          },
          overrides: [],
        },
      },
      {
        id: 2,
        title: 'Public profile fetch latency (p50 / p95)',
        type: 'timeseries',
        gridPos: { h: 9, w: 12, x: 12, y: 0 },
        datasource: ds,
        targets: [
          {
            expr: `histogram_quantile(0.50, sum by (le) (rate(person_profile_public_request_duration_milliseconds_bucket{${labels}}[5m])))`,
            legendFormat: 'p50',
            refId: 'A',
          },
          {
            expr: `histogram_quantile(0.95, sum by (le) (rate(person_profile_public_request_duration_milliseconds_bucket{${labels}}[5m])))`,
            legendFormat: 'p95',
            refId: 'B',
          },
        ],
        fieldConfig: {
          defaults: {
            unit: 'ms',
            min: 0,
            custom: { fillOpacity: 10, lineWidth: 2 },
          },
          overrides: [],
        },
      },
      {
        id: 3,
        title: 'Owner mutations by action (rate)',
        type: 'timeseries',
        gridPos: { h: 9, w: 12, x: 0, y: 9 },
        datasource: ds,
        targets: [
          {
            expr: `sum by (action) (rate(person_profile_mutation_count_total{${labels}}[5m]))`,
            legendFormat: '{{action}}',
            refId: 'A',
          },
        ],
        fieldConfig: {
          defaults: {
            unit: 'ops',
            min: 0,
            custom: { fillOpacity: 10, lineWidth: 2 },
          },
          overrides: [],
        },
      },
      {
        id: 4,
        title: 'Marketing revalidation by result (rate)',
        type: 'timeseries',
        gridPos: { h: 9, w: 12, x: 12, y: 9 },
        datasource: ds,
        targets: [
          {
            expr: `sum by (result) (rate(person_profile_revalidation_count_total{${labels}}[5m]))`,
            legendFormat: '{{result}}',
            refId: 'A',
          },
        ],
        fieldConfig: {
          defaults: {
            unit: 'ops',
            min: 0,
            custom: { fillOpacity: 10, lineWidth: 2 },
          },
          overrides: [
            {
              matcher: { id: 'byName', options: 'failed' },
              properties: [
                { id: 'color', value: { mode: 'fixed', fixedColor: 'red' } },
              ],
            },
          ],
        },
      },
      {
        id: 5,
        title: 'Live profile serves (last 24h)',
        type: 'stat',
        gridPos: { h: 6, w: 8, x: 0, y: 18 },
        datasource: ds,
        targets: [
          {
            expr: `sum(increase(person_profile_public_request_count_total{${labels}, result="live"}[24h]))`,
            legendFormat: 'live',
            refId: 'A',
          },
        ],
        fieldConfig: { defaults: { unit: 'short', min: 0 }, overrides: [] },
      },
      {
        id: 6,
        title: 'Failed revalidations (last 24h)',
        type: 'stat',
        gridPos: { h: 6, w: 8, x: 8, y: 18 },
        datasource: ds,
        targets: [
          {
            expr: `sum(increase(person_profile_revalidation_count_total{${labels}, result="failed"}[24h]))`,
            legendFormat: 'failed',
            refId: 'A',
          },
        ],
        fieldConfig: {
          defaults: {
            unit: 'short',
            min: 0,
            thresholds: {
              steps: [
                { color: 'green', value: null },
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
