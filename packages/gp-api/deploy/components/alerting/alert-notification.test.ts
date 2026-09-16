import { describe, expect, it } from 'vitest'
import {
  buildAlertDescription,
  buildAlertSummary,
  buildKnownCausesAnnotation,
  KNOWN_CAUSES_ANNOTATION,
} from './alert-notification'
import { Alert, KnownCause } from './alerts.types'

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

describe('buildKnownCausesAnnotation', () => {
  const cause: KnownCause = {
    id: 'people-db-statement-timeout',
    summary: 'A district too large for the current query plan.',
    evidence: '{deployment_environment_name="$ENV"} |= "PackBuildFailed"',
    confirmedBy: 'Every matched line carries `Code: 57014`.',
    action: 'suppress',
  }

  // The filter reads a missing annotation as "nothing is known here, notify".
  // An empty array would have to mean the same thing, and two spellings of one
  // meaning is how the two sides of a contract end up disagreeing.
  it('emits nothing for an alert with no known causes', () => {
    expect(buildKnownCausesAnnotation(alert, 'prod')).toBeUndefined()
    expect(
      buildKnownCausesAnnotation({ ...alert, knownCauses: [] }, 'prod'),
    ).toBeUndefined()
  })

  // Evidence is written against $ENV like `expr` and `message` are, and the
  // filter runs the query as given. Substituting at provision time is what
  // makes the dev rule's evidence read dev logs without the filter having to
  // work out which environment notified it.
  it('resolves $ENV in evidence against the provisioning environment', () => {
    const dev = JSON.parse(
      buildKnownCausesAnnotation({ ...alert, knownCauses: [cause] }, 'dev')!,
    )

    expect(dev[0].evidence).toContain('deployment_environment_name="dev"')
    expect(dev[0].evidence).not.toContain('$ENV')
  })

  it('leaves a cause that judges on the payload alone without evidence', () => {
    const { evidence: _evidence, ...noEvidence } = cause
    const parsed = JSON.parse(
      buildKnownCausesAnnotation(
        { ...alert, knownCauses: [noEvidence] },
        'prod',
      )!,
    )

    expect(parsed[0]).not.toHaveProperty('evidence')
  })

  // Every field is part of the filter's contract: `id` is the metric dimension
  // the weekly digest groups by, `action` decides whether a human sees the
  // alert, and `summary` is quoted into the Slack reply. Dropping any one of
  // them degrades quietly rather than failing, so round-tripping is asserted
  // rather than spot-checked.
  it('round-trips every field the filter depends on', () => {
    const parsed = JSON.parse(
      buildKnownCausesAnnotation({ ...alert, knownCauses: [cause] }, 'prod')!,
    )

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toEqual({
      ...cause,
      evidence: cause.evidence!.replace('$ENV', 'prod'),
    })
  })

  // Annotations ride along on every notification for the rule, so this is a
  // per-firing payload cost rather than a one-off at provision time.
  it('serialises compactly', () => {
    const annotation = buildKnownCausesAnnotation(
      { ...alert, knownCauses: [cause] },
      'prod',
    )!

    expect(annotation).not.toContain('\n')
  })

  // The other half of the contract `payload.py`'s test asserts. The name is
  // shared with a repo this one cannot import from, and renaming it on either
  // side makes every alert look like it has no known causes: the filter then
  // notifies everything, which is safe, but the whole feature is silently gone
  // with nothing failing to say so.
  it('pins the annotation key the Python filter reads', () => {
    expect(KNOWN_CAUSES_ANNOTATION).toBe('known_causes')
  })

  it('preserves the order causes are declared in', () => {
    const second: KnownCause = { ...cause, id: 'upstream-404' }
    const parsed = JSON.parse(
      buildKnownCausesAnnotation(
        { ...alert, knownCauses: [cause, second] },
        'prod',
      )!,
    )

    expect(parsed.map((c: KnownCause) => c.id)).toEqual([cause.id, second.id])
  })
})
