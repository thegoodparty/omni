import { describe, expect, it } from 'vitest'
import { GLOBAL_ALERTS } from '../alerts'
import { alertQueryModel } from '../grafana'
import { jobAlerts } from './job-alerts'

describe('job alerts', () => {
  it('registers the dead-letter alert', () => {
    const slugs = GLOBAL_ALERTS.map((alert) => alert.slug)
    expect(slugs).toContain('jobs-dead-letter')
  })

  it('reads the dead-letter count for its own environment, at Maximum', () => {
    const [alert] = jobAlerts
    if (!alert) throw new Error('no job alert to assert against')

    const model = JSON.parse(alertQueryModel(alert, 'prod'))
    expect(model).toMatchObject({
      queryMode: 'Metrics',
      namespace: 'GpApi/Jobs',
      metricName: 'DeadLetterJobs',
      dimensions: { Environment: ['prod'] },
      statistic: 'Maximum',
      region: 'us-west-2',
    })
  })

  it('fires on any dead letter and keeps the last answer on a query error', () => {
    const [alert] = jobAlerts
    expect(alert?.threshold).toBe(0)
    expect(alert?.execErrState).toBe('KeepLast')
  })
})
