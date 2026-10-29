import { describe, expect, it } from 'vitest'
import { GLOBAL_ALERTS } from '../alerts'
import { alertQueryModel } from '../grafana'
import { sesReputationAlerts } from './ses-reputation-alerts'

describe('ses reputation alerts', () => {
  it('registers both account alarms', () => {
    const slugs = GLOBAL_ALERTS.map((alert) => alert.slug)
    expect(slugs).toContain('ses-bounce-rate')
    expect(slugs).toContain('ses-complaint-rate')
  })

  it('warns below SES review lines of 5% bounces and 0.1% complaints', () => {
    const bySlug = Object.fromEntries(
      sesReputationAlerts.map((alert) => [alert.slug, alert.threshold]),
    )
    expect(bySlug['ses-bounce-rate']).toBe(0.03)
    expect(bySlug['ses-complaint-rate']).toBe(0.0006)
  })

  it('reads the account-level metric with no dimensions', () => {
    for (const alert of sesReputationAlerts) {
      const model = JSON.parse(alertQueryModel(alert, 'prod'))
      expect(model).toMatchObject({
        queryMode: 'Metrics',
        namespace: 'AWS/SES',
        metricName: alert.expr,
        dimensions: {},
        region: 'us-west-2',
      })
    }
  })
})

describe('ses reputation alerts stay quiet in normal use', () => {
  it('keeps the last answer when the query errors', () => {
    for (const alert of sesReputationAlerts) {
      expect(alert.execErrState, alert.slug).toBe('KeepLast')
    }
  })

  it('needs three 5-minute datapoints above the line before it pages', () => {
    for (const alert of sesReputationAlerts) {
      expect(alert.for, alert.slug).toBe('15m')
    }
  })
})
