// The production election database, read through the CloudWatch data source
// next to gp-api's connection errors against it in Loki. Built for the P1001
// ("Can't reach database server") and P2024 (pool timeout) bursts: the panels
// separate a database restart, a connection storm and task churn.

export const CLOUDWATCH_DATASOURCE_UID = 'aws-cloudwatch-prod'

// Created by the ops repo (deploy/components/grafana-cloudwatch-read.ts).
export const GRAFANA_CLOUDWATCH_ROLE_ARN =
  'arn:aws:iam::333022194791:role/grafana-cloudwatch-read'

const REGION = 'us-west-2'
const CLUSTER = 'election-api-db-prod'
const ECS_CLUSTER = 'gp-master-fargateCluster'
const ECS_SERVICE = 'gp-api-master'

// Written by the EventBridge rule in components/election-db.ts.
export const RDS_EVENTS_LOG_GROUP = `/aws/events/rds/${CLUSTER}`

export interface ElectionDbDashboardConfig {
  lokiDatasourceUid: string
}

const cloudwatchMetric = (
  refId: string,
  namespace: string,
  metricName: string,
  dimensions: Record<string, string>,
  statistic: string,
  label: string,
) => ({
  refId,
  datasource: { type: 'cloudwatch', uid: CLOUDWATCH_DATASOURCE_UID },
  queryMode: 'Metrics',
  metricQueryType: 0,
  metricEditorMode: 0,
  region: REGION,
  namespace,
  metricName,
  dimensions,
  statistic,
  period: '60',
  matchExact: true,
  id: '',
  expression: '',
  label,
})

const rdsMetric = (
  refId: string,
  metricName: string,
  statistic: string,
  label: string,
) =>
  cloudwatchMetric(
    refId,
    'AWS/RDS',
    metricName,
    { DBClusterIdentifier: CLUSTER },
    statistic,
    label,
  )

const timeseries = (
  id: number,
  title: string,
  gridPos: { h: number; w: number; x: number; y: number },
  datasource: { type: string; uid: string },
  targets: object[],
  unit: string,
) => ({
  id,
  title,
  type: 'timeseries',
  gridPos,
  datasource,
  targets,
  fieldConfig: {
    defaults: { unit, min: 0, custom: { fillOpacity: 10, lineWidth: 2 } },
    overrides: [],
  },
})

export function electionDbDashboardConfigJson({
  lokiDatasourceUid,
}: ElectionDbDashboardConfig): string {
  const loki = { type: 'loki', uid: lokiDatasourceUid }
  const cloudwatch = { type: 'cloudwatch', uid: CLOUDWATCH_DATASOURCE_UID }

  return JSON.stringify({
    title: 'Election database (prod)',
    uid: 'election-api-prod-database',
    editable: true,
    timezone: 'browser',
    time: { from: 'now-24h', to: 'now' },
    refresh: '1m',
    panels: [
      timeseries(
        1,
        'Election database errors per minute (gp-api)',
        { h: 8, w: 12, x: 0, y: 0 },
        loki,
        [
          {
            refId: 'A',
            datasource: loki,
            // gp-api has two Prisma clients. A P1001 against this database names
            // its host, and a P2024 names the election model it was reading, so
            // keep only those; the main database's errors belong elsewhere.
            expr: 'sum by (exception_type) (count_over_time({service_name="gp-api", deployment_environment_name="prod"} |~ "election-api-db|prisma\\\\.(race|place|person|personMerge|candidacy|officeHolder|district|projectedTurnout|zipToPosition|stance|issue)\\\\." | exception_type=~"P1001|P2024" [1m]))',
            legendFormat: '{{exception_type}}',
          },
        ],
        'short',
      ),
      timeseries(
        2,
        'Database connections',
        { h: 8, w: 12, x: 12, y: 0 },
        cloudwatch,
        [rdsMetric('A', 'DatabaseConnections', 'Maximum', 'connections')],
        'short',
      ),
      timeseries(
        3,
        'gp-api running tasks',
        { h: 8, w: 12, x: 0, y: 8 },
        cloudwatch,
        [
          cloudwatchMetric(
            'A',
            'ECS/ContainerInsights',
            'RunningTaskCount',
            { ClusterName: ECS_CLUSTER, ServiceName: ECS_SERVICE },
            'Average',
            'running tasks',
          ),
        ],
        'short',
      ),
      timeseries(
        4,
        'Database CPU and capacity',
        { h: 8, w: 12, x: 12, y: 8 },
        cloudwatch,
        [
          rdsMetric('A', 'CPUUtilization', 'Maximum', 'CPU %'),
          rdsMetric('B', 'ServerlessDatabaseCapacity', 'Maximum', 'ACU'),
        ],
        'short',
      ),
      // A drop to near zero is a restart that RDS may not report as an event.
      timeseries(
        5,
        'Database engine uptime',
        { h: 8, w: 12, x: 0, y: 16 },
        cloudwatch,
        [rdsMetric('A', 'EngineUptime', 'Minimum', 'uptime')],
        's',
      ),
      timeseries(
        6,
        'Database freeable memory',
        { h: 8, w: 12, x: 12, y: 16 },
        cloudwatch,
        [rdsMetric('A', 'FreeableMemory', 'Minimum', 'freeable')],
        'bytes',
      ),
      {
        id: 7,
        title: 'RDS events (failover, reboot, maintenance)',
        type: 'logs',
        gridPos: { h: 8, w: 24, x: 0, y: 24 },
        datasource: cloudwatch,
        targets: [
          {
            refId: 'A',
            datasource: cloudwatch,
            queryMode: 'Logs',
            region: REGION,
            logGroupNames: [RDS_EVENTS_LOG_GROUP],
            expression:
              'fields @timestamp, detail.SourceIdentifier, detail.Message\n| sort @timestamp desc',
            statsGroups: [],
          },
        ],
        options: {
          showTime: true,
          wrapLogMessage: true,
          sortOrder: 'Descending',
        },
      },
    ],
  })
}
