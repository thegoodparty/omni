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

  it("reads gp-api's reputation gauges, holding each task's last reading", () => {
    const bySlug = Object.fromEntries(
      sesReputationAlerts.map((alert) => [alert.slug, alert]),
    )
    for (const [slug, metric] of [
      ['ses-bounce-rate', 'ses_account_bounce_rate'],
      ['ses-complaint-rate', 'ses_account_complaint_rate'],
    ]) {
      const alert = bySlug[slug]
      expect(alert.type).toBe('metric')
      expect(JSON.parse(alertQueryModel(alert, 'prod')).expr).toBe(
        `max(last_over_time(${metric}{service_name="gp-api", ` +
          'deployment_environment_name="prod"}[15m]))',
      )
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
