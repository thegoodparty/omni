import { describe, expect, it } from 'vitest'
import { buildAlertDescription } from './alert-description'
import { Alert } from './alerts.types'

const alert: Alert = {
  slug: 'GET--v1-door-knocking-turfs--id-route-error-count',
  name: '[door-knocking] GET /v1/door-knocking/turfs/:id/route - Errors detected',
  type: 'log',
  expr: 'sum(count_over_time({deployment_environment_name="$ENV"} [10m]))',
  for: '1m',
  threshold: 0,
  message: '`GET /v1/door-knocking/turfs/:id/route` returned server errors.',
  notify: 'win-bugs',
}

describe('buildAlertDescription', () => {
  it('names the environment the alert fired in', () => {
    expect(buildAlertDescription(alert, 'prod')).toContain('[PROD]')
    expect(buildAlertDescription(alert, 'dev')).toContain('[DEV]')
  })

  // The regression, and it cost real triage time on the 2026-08-20
  // door-knocking page: both environments provision this rule from the same
  // definition, and a Slack notification carries neither the rule's
  // environment label nor its folder. Without the prefix the two pages were
  // byte-identical down to the group mention, so the recipient could not tell
  // whether production was broken without opening Grafana.
  it('sends a different page for dev than for prod', () => {
    expect(buildAlertDescription(alert, 'dev')).not.toEqual(
      buildAlertDescription(alert, 'prod'),
    )
  })

  it('substitutes $ENV and appends the owning group mention', () => {
    const description = buildAlertDescription(
      { ...alert, message: 'errors in $ENV' },
      'prod',
    )

    expect(description).toContain('errors in prod')
    expect(description).toContain('<!subteam^S0AE3NTCXM3>')
  })

  it('omits the mention for an alert nobody owns', () => {
    const description = buildAlertDescription(
      { ...alert, notify: undefined },
      'prod',
    )

    expect(description).not.toContain('<!subteam^')
    expect(description.trimEnd()).toEqual(description)
  })
})
