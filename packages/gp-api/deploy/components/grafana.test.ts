import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLOBAL_ALERTS } from './alerts'
import { routeErrorAlerts } from './alerting/route-alerts'
import { ALERT_FILTER_WEBHOOK_URLS, alertQueryModel } from './grafana'
import {
  recordingRuleExpression,
  RECORDING_RULES,
} from './alerting/provisioned-alerts'

/**
 * The Terraform that publishes the endpoint Pulumi points Grafana at.
 *
 * Read from disk rather than imported, because it is HCL in another package's
 * infrastructure root and there is no other way for a test in gp-api to see it.
 */
const SHARED_INFRA = join(
  __dirname,
  '../../../gp-ai/infrastructure/environments/prod/shared-infra/main.tf',
)

describe('the alert filter webhook address', () => {
  // The URL used to come from ALERT_FILTER_WEBHOOK_URL in the deploy
  // environment, which nothing set, so the contact point was never created and
  // the whole feature sat dark. Making it a constant fixes that but buys a new
  // way to be wrong: a constant in Pulumi and a path in Terraform that quietly
  // disagree, which fails as a 404 on the first alert Grafana tries to deliver
  // and nowhere earlier.
  it('matches the path the ALB actually routes', () => {
    const terraform = readFileSync(SHARED_INFRA, 'utf8')

    const rule = terraform.slice(
      terraform.indexOf('resource "aws_lb_listener_rule" "alert_filter"'),
    )
    const pathPattern = /path_pattern\s*{\s*values\s*=\s*\["([^"]+)"\]/.exec(
      rule,
    )

    expect(
      pathPattern,
      'no path_pattern found on the alert_filter listener rule',
    ).not.toBeNull()

    const { pathname } = new URL(ALERT_FILTER_WEBHOOK_URLS.prod)
    expect(pathname).toBe(pathPattern?.[1])
  })

  // Not just "is a URL": an http address here would send the shared secret and
  // every alert body over the open internet in cleartext, and the secret is
  // what stops anyone posting arbitrary text into an engineering channel.
  it('is https on the host the ALB serves', () => {
    const { protocol, hostname } = new URL(ALERT_FILTER_WEBHOOK_URLS.prod)

    expect(protocol).toBe('https:')
    expect(hostname).toBe('ai.goodparty.org')
  })

  // One Lambda serves both environments' alerts, so a dev entry would point at
  // a host that does not answer. The deploy is written to skip loudly on a
  // missing entry; this asserts that dev really is missing rather than someone
  // having added a plausible-looking dev URL later.
  it('claims an endpoint only for prod', () => {
    expect(Object.keys(ALERT_FILTER_WEBHOOK_URLS)).toEqual(['prod'])
  })
})

describe('the recording rule expression', () => {
  /**
   * These pin the blob to the PROVIDER's input dialect, which is not the
   * dialect of the API behind it. The provider picks these snake_case keys
   * out by hand and re-marshals them as the API's camelCase, so asserting
   * the API's spelling here would assert the bug.
   */
  const [rule] = RECORDING_RULES
  if (!rule) {
    throw new Error('no recording rule is provisioned to assert against')
  }
  const expression = JSON.parse(recordingRuleExpression(rule, 'dev'))

  it('names the datasource and query type the way the provider reads', () => {
    expect(expression.datasource_uid).toBe('grafanacloud-logs')
    expect(expression.query_type).toBe('instant')

    // The API's own casing is the trap, not a harmless synonym: the provider
    // looks for the keys above, finds nothing, and sends the expression with
    // these fields missing.
    expect(expression).not.toHaveProperty('datasourceUID')
    expect(expression).not.toHaveProperty('queryType')
    expect(expression).not.toHaveProperty('relativeTimeRange')
  })

  it('gives the time range as duration strings', () => {
    // The regression that broke the release train twice on 2026-09-28. The
    // provider reads these through a Go `.(string)` assertion, so a number
    // empties both ends and makes it drop the whole range from the request;
    // Grafana then 403s with `query expressions must have a relative time
    // range`. Numbers must stay unrepresentable here.
    expect(expression.relative_time_range).toEqual({
      from: `${rule.fromSeconds}s`,
      to: `${rule.toSeconds}s`,
    })
    expect(typeof expression.relative_time_range.from).toBe('string')
    expect(typeof expression.relative_time_range.to).toBe('string')
  })

  it('ends the window in the past and marks its output', () => {
    // Log lines reach Loki seconds late and each window starts where the last
    // one ended, so a window ending at `now` drops them permanently.
    expect(rule.toSeconds).toBeGreaterThan(0)
    expect(rule.fromSeconds).toBeGreaterThan(rule.toSeconds)

    // Without `source` the rule saves cleanly and records nothing.
    expect(expression.source).toBe(true)

    // A range query returns a series of points per evaluation; a recording
    // rule wants one value per label set.
    expect(expression.model.instant).toBe(true)
    expect(expression.model.range).toBe(false)

    // AND THIS IS THE KEY THAT ACTUALLY DECIDES IT. Loki's backend reads
    // `queryType` from the model JSON; the two booleans above are the query
    // editor's state and `query_type` is the DataQuery level. Without this
    // key the rule ran a range query from 2026-09-29 18:51Z onward and every
    // evaluation was rejected with `unsupported time series type
    // "timeseries-multi"`, so the metric was never written and the five
    // Geoapify budget rules reading it were blind.
    expect(expression.model.queryType).toBe('instant')
  })

  it('substitutes the environment into the query', () => {
    expect(expression.model.expr).toContain('deployment_environment_name="dev"')
    expect(expression.model.expr).not.toContain('$ENV')
  })
})

describe('the alert query model', () => {
  // The same trap the recording rule fell into, on every log alert. Loki's
  // backend reads `queryType` out of the model JSON, and without it each rule
  // ran as a range query that read its fetch window on top of its range
  // vector: 2.4x to 3x the bytes, measured on 2026-10-09, for the single value
  // `reduce: last` keeps.
  it('runs every log rule as an instant query', () => {
    const logAlerts = [...GLOBAL_ALERTS, ...routeErrorAlerts()].filter(
      (alert) => alert.type === 'log',
    )
    expect(logAlerts.length).toBeGreaterThan(0)

    for (const alert of logAlerts) {
      const model = JSON.parse(alertQueryModel(alert, 'prod'))
      expect(model.queryType, alert.slug).toBe('instant')
      expect(model.instant, alert.slug).toBe(true)
      expect(model.range, alert.slug).toBe(false)
    }
  })

  it('leaves Prometheus queries as they were', () => {
    const metricAlert = GLOBAL_ALERTS.find((alert) => alert.type === 'metric')
    if (!metricAlert) throw new Error('no metric alert to assert against')

    const model = JSON.parse(alertQueryModel(metricAlert, 'prod'))
    expect(model).not.toHaveProperty('queryType')
  })

  it('substitutes the environment into the query', () => {
    const [alert] = routeErrorAlerts()
    if (!alert) throw new Error('no route alert to assert against')

    const model = JSON.parse(alertQueryModel(alert, 'prod'))
    expect(model.expr).toContain('deployment_environment_name="prod"')
    expect(model.expr).not.toContain('$ENV')
  })
})
