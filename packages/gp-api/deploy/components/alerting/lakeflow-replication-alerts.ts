import { Alert } from './alerts.types'

const GIB = 1024 ** 3

const RUNBOOK = 'packages/gp-api/deploy/databricks/lakeflow/README.md'

/**
 * Both clusters, from the prod stack, because only the prod stack provisions
 * alert rules. The dev mirror holds a slot too, and Aurora keeps WAL for a
 * stalled slot without limit on either cluster.
 *
 * `Role = 'WRITER'` follows the writer through a failover, which is the only
 * instance that can hold a logical slot.
 */
const CLUSTERS = [
  { cluster: 'gp-api-db', label: 'dev' },
  { cluster: 'gp-api-db-prod', label: 'prod' },
] as const

const METRICS = [
  {
    metric: 'OldestReplicationSlotLag',
    slug: 'slot-lag',
    title: 'replication slot lag',
    threshold: GIB,
    meaning:
      'the Lakeflow ingestion gateway is not reading the `databricks_lakeflow` slot, so the mirror is falling behind',
  },
  {
    metric: 'ReplicationSlotDiskUsage',
    slug: 'slot-disk',
    title: 'replication slot disk usage',
    threshold: 5 * GIB,
    meaning:
      'the slot is holding change log the gateway has not confirmed, and Aurora keeps it until the slot is read or dropped',
  },
  {
    metric: 'TransactionLogsDiskUsage',
    slug: 'wal-disk',
    title: 'transaction log disk usage',
    threshold: 5 * GIB,
    meaning:
      'write-ahead log is piling up on the writer, almost always because a replication slot is not being read',
  },
] as const

export const lakeflowReplicationAlerts: Alert[] = CLUSTERS.flatMap(
  ({ cluster, label }) =>
    METRICS.map(({ metric, slug, title, threshold, meaning }) => ({
      slug: `lakeflow-${label}-${slug}`,
      name: `[Lakeflow] ${cluster} (${label}) ${title} above ${threshold / GIB} GiB`,
      type: 'cloudwatch' as const,
      expr: `SELECT MAX(${metric}) FROM SCHEMA("AWS/RDS", DBClusterIdentifier, Role) WHERE DBClusterIdentifier = '${cluster}' AND Role = 'WRITER'`,
      threshold,
      for: '15m' as const,
      evaluationIntervalSeconds: 300,
      // Aurora publishes these with or without a slot (0 or -1 when there is
      // none), so no data means the query broke, not that all is well.
      noDataState: 'Alerting' as const,
      message: [
        `${metric} on the ${cluster} writer has been above ${threshold / GIB} GiB for 15 minutes: ${meaning}.`,
        `Check the gateway (Jobs & Pipelines > gp-api-mirror-${label}-gateway) and the slot (\`SELECT slot_name, active, wal_status FROM pg_replication_slots\`). If the gateway is down, restart it; if the mirror is being retired, drop the slot. Steps for both: ${RUNBOOK} § Failure modes.`,
      ].join('\n\n'),
    })),
)
