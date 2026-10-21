import { describe, expect, it } from 'vitest'
import { GLOBAL_ALERTS } from '../alerts'
import { alertQueryModel } from '../grafana'
import { lakeflowReplicationAlerts } from './lakeflow-replication-alerts'

describe('lakeflowReplicationAlerts', () => {
  it('watches all three slot metrics on both gp-api clusters', () => {
    const watched = lakeflowReplicationAlerts.map((alert) => alert.expr)
    for (const cluster of ['gp-api-db', 'gp-api-db-prod']) {
      for (const metric of [
        'OldestReplicationSlotLag',
        'ReplicationSlotDiskUsage',
        'TransactionLogsDiskUsage',
      ]) {
        expect(watched).toContainEqual(
          expect.stringMatching(
            new RegExp(`MAX\\(${metric}\\).*'${cluster}' AND Role`),
          ),
        )
      }
    }
    expect(lakeflowReplicationAlerts).toHaveLength(6)
  })

  it('is provisioned with the global alerts', () => {
    for (const alert of lakeflowReplicationAlerts) {
      expect(GLOBAL_ALERTS).toContain(alert)
    }
  })

  it('sends Metrics Insights SQL that follows the writer', () => {
    for (const alert of lakeflowReplicationAlerts) {
      const model = JSON.parse(alertQueryModel(alert, 'prod'))
      expect(model.metricQueryType, alert.slug).toBe(1)
      expect(model.metricEditorMode, alert.slug).toBe(1)
      expect(model.sqlExpression, alert.slug).toContain("Role = 'WRITER'")
      expect(model).not.toHaveProperty('expr')
    }
  })
})
