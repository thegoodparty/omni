import { describe, expect, it } from 'vitest'
import { buildAlertDescription, buildAlertSummary } from './alert-notification'
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

// The regression, and it cost real triage time on the 2026-08-20
// door-knocking page: both environments provision this rule from the same
// definition, and a Slack notification carries neither the rule's environment
// label nor its folder. The two pages were identical down to the group
// mention, so the recipient could not tell whether production was broken
// without opening Grafana. Neither the title nor the body may be the field
// their contact point happens to show, so both have to name the environment.
describe.each([
  ['summary', buildAlertSummary],
  ['description', buildAlertDescription],
])('%s', (_field, build) => {
  it('names the environment the alert fired in', () => {
    expect(build(alert, 'prod')).toContain('[PROD]')
    expect(build(alert, 'dev')).toContain('[DEV]')
  })

  it('reads differently for dev than for prod', () => {
    expect(build(alert, 'dev')).not.toEqual(build(alert, 'prod'))
  })
})

describe('buildAlertSummary', () => {
  it('keeps the rule name that identifies the route', () => {
    expect(buildAlertSummary(alert, 'prod')).toContain(alert.name)
  })

  // One rule now covers every route on a controller and fires once per route,
  // so the rule name alone says only which controller is unhappy. The title is
  // what someone scanning Slack reads before deciding whether to open it, so
  // the route that actually broke has to survive into it.
  it('appends the per-instance detail for a multi-series rule', () => {
    const summary = buildAlertSummary(
      { ...alert, summaryDetail: '`{{ $labels.request_endpoint }}`' },
      'prod',
    )

    expect(summary).toContain('{{ $labels.request_endpoint }}')
  })

  it('leaves no dangling separator for a rule without detail', () => {
    expect(buildAlertSummary(alert, 'prod').trimEnd()).toEqual(
      buildAlertSummary(alert, 'prod'),
    )
  })
})

describe('buildAlertDescription', () => {
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
