import { describe, expect, it } from 'vitest'
import { alertQueryModel, alertTimeRange } from '../grafana'
import {
  EXTENSION_FRAMES,
  FRONTEND_ERROR_ALERTS,
  NETWORK_FAILURE_MESSAGES,
} from './frontend-error-alerts'
import { provisionedAlertSlugs } from './provisioned-alerts'

const UNIT_SECONDS: Record<string, number> = { m: 60, h: 3600, d: 86400 }

/** Every range vector in a LogQL expression, in seconds. */
const rangeVectors = (expr: string) =>
  [...expr.matchAll(/\[(\d+)([mhd])\]/g)].map(
    ([, amount, unit]) => Number(amount) * UNIT_SECONDS[unit!]!,
  )

const spreading = FRONTEND_ERROR_ALERTS.find(
  (a) => a.slug === 'frontend-error-spreading',
)!
const newError = FRONTEND_ERROR_ALERTS.find(
  (a) => a.slug === 'frontend-error-new',
)!

describe('front-end error alerts', () => {
  it('are provisioned, so the routing check walks them', () => {
    for (const alert of FRONTEND_ERROR_ALERTS) {
      expect(provisionedAlertSlugs()).toContain(alert.slug)
    }
  })

  it('read only the gp-webapp exception stream, for the alert environment', () => {
    for (const alert of FRONTEND_ERROR_ALERTS) {
      const expr = JSON.parse(alertQueryModel(alert, 'prod')).expr as string
      expect(expr, alert.slug).toContain(
        '{service_name="gp-webapp-prod", kind="exception"}',
      )
      expect(expr, alert.slug).toContain('app_environment = "prod"')
      expect(expr, alert.slug).not.toContain('$ENV')
    }
  })

  // The labels are what Delegate files and dedups a ticket on, and what the
  // notification title names, so every series has to carry the group.
  it('return one series per error group, labelled with it', () => {
    for (const alert of FRONTEND_ERROR_ALERTS) {
      expect(alert.expr, alert.slug).toMatch(
        /^(count|sum) by \(error_type, error_message\)/,
      )
      expect(alert.summaryDetail, alert.slug).toContain('error_message')
    }
  })

  it('page on three distinct sessions, not three errors', () => {
    expect(spreading.threshold).toBe(2)
    expect(spreading.expr).toContain(
      'sum by (error_type, error_message, session_id)',
    )
  })

  it('call a group new only when the week before the window lacks it', () => {
    expect(newError.expr).toContain(' unless ')
    expect(newError.expr).toContain('[7d] offset 1h')
    expect(newError.threshold).toBe(0)
  })

  // A window narrower than the interval leaves time no evaluation reads.
  it('leave no gap between one evaluation and the next', () => {
    for (const alert of FRONTEND_ERROR_ALERTS) {
      const current = Math.min(...rangeVectors(alert.expr))
      expect(current, alert.slug).toBeGreaterThanOrEqual(
        alert.evaluationIntervalSeconds!,
      )
      expect(alertTimeRange(alert).from - alertTimeRange(alert).to).toBe(
        current,
      )
    }
  })

  /**
   * Days of the gp-webapp exception stream read per day, the same measure
   * global-alerts.test.ts applies to the gp-api stream: Loki bills the bytes
   * each evaluation decompresses, which is the sum of its range vectors.
   *
   * 12 for the spreading rule (an hour, every five minutes) and 169 for the
   * new-error rule (a week and an hour, hourly). The stream is small, about
   * 85 issues a month in the previous error tracker, so 181 days of it a day is
   * well under what one day of gp-api costs. The ceiling is here so that a
   * faster interval on the week-long read shows up as a test failure rather
   * than a bill.
   */
  it('stay inside their read budget', () => {
    const rereads = FRONTEND_ERROR_ALERTS.reduce(
      (sum, alert) =>
        sum +
        rangeVectors(alert.expr).reduce((a, b) => a + b, 0) /
          alert.evaluationIntervalSeconds!,
      0,
    )
    expect(rereads).toBeLessThanOrEqual(200)
  })
})

describe('front-end error noise', () => {
  const isNetworkFailure = (message: string) =>
    new RegExp(NETWORK_FAILURE_MESSAGES, 'i').test(message)

  it.each([
    'Failed to fetch',
    'Failed to fetch (gp-api.goodparty.org)',
    'Load failed',
    'NetworkError when attempting to fetch resource.',
    'Network request failed',
    // The wrapper ofetch composes before a call site sees the error. This is
    // the exact value of the line that filed ENG-11636.
    '[GET] "/api/v1/elected-office/mine": <no response> Failed to fetch',
    '[POST] "/api/v1/campaigns": <no response> Load failed',
    '[GET] "/api/v1/x": <no response> Failed to fetch (gp-api.goodparty.org)',
  ])('drops the network failure %j', (message) => {
    expect(isNetworkFailure(message)).toBe(true)
  })

  it.each([
    'Connection closed',
    'Failed to fetch dynamically imported module: https://app.goodparty.org/_next/static/chunks/1.js',
    'Loading chunk 123 failed.',
    "Cannot read properties of undefined (reading 'slug')",
    // ofetch's wrapper again, but with a response: a status we can fix.
    '[POST] "/v1/contacts": 400 ',
    '[GET] "/api/v1/x": 504 Gateway Timeout',
    '[GET] "/api/v1/x": <no response> Failed to fetch dynamically imported module',
  ])('keeps %j', (message) => {
    expect(isNetworkFailure(message)).toBe(false)
  })

  it('drops errors thrown from a browser extension frame', () => {
    const extension = new RegExp(EXTENSION_FRAMES)
    expect(
      extension.test('at n (chrome-extension://abcdef/content.js:1:200)'),
    ).toBe(true)
    expect(
      extension.test(
        'at n (https://app.goodparty.org/_next/static/chunks/1.js:1:200)',
      ),
    ).toBe(false)
  })
})
