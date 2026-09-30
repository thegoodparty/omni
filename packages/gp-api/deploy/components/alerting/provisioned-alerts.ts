import { GLOBAL_ALERTS } from '../alerts'
import { RecordingRule } from './alerts.types'
import { routeErrorAlerts } from './route-alerts'
import { DOOR_KNOCKING_SPEND_RECORDING_RULE } from './door-knocking-spend'

const LOKI_DATASOURCE_UID = 'grafanacloud-logs'

/**
 * Every scheduled read of a Loki stream this repo provisions that is NOT an
 * alert rule.
 *
 * WHY THEY ARE ENUMERATED IN ONE PLACE, and why the enumeration is checked. A
 * Loki-backed rule re-reads its whole fetch window on every evaluation, and
 * only the stream selector and that window decide the bytes — so a rule's daily
 * read volume, as a multiple of what we ingest, is exactly `window ÷ interval`.
 * The plan includes log queries up to 100x ingest, and that allowance is
 * shared: by every rule, by both environments, and by whatever a human types
 * into Explore. A limit that is only ever applied one rule at a time therefore
 * cannot say whether the estate fits, which is how four rules that each passed
 * a 100x per-rule ceiling came to be budgeted at 384% of the whole allowance
 * and spent 4.4x of it (2026-09-29).
 *
 * WHAT A RECORDING RULE IS AND IS NOT GOOD FOR, learned expensively. It reads
 * one minute of logs once a minute — the floor, 1x ingest — writes the result
 * to Prometheus, and every alert that wants a wider window assembles it there,
 * where the read costs nothing. Its cost does not grow with the number of
 * alerts consuming it. That is genuinely the only way to afford a 24h window,
 * which is why door knocking's credit spend is still recorded.
 *
 * But Grafana's recording-rule writer only accepts a wide frame, and a Loki
 * query that returns one series per label set is `timeseries-multi`, which it
 * rejects — silently, because a rule that writes nothing looks identical to a
 * rule with nothing to write. Two route recording rules were added on
 * 2026-09-28 and never wrote a datapoint, taking 168 alert rules blind with
 * them. So a recording rule here has to aggregate to ONE
 * unlabelled series, and anything that needs a dimension preserved reads Loki
 * directly. The route alerts do, which is what `routeAlertGroups` exists to
 * make affordable.
 *
 * `global-alerts.test.ts` sums `window ÷ interval` across these, the
 * log-backed global alerts and the route alerts, and fails when the total
 * leaves too little of the allowance for anything else.
 */
export const RECORDING_RULES: RecordingRule[] = [
  DOOR_KNOCKING_SPEND_RECORDING_RULE,
]

/**
 * The `expressions` entry for one recording rule, as the JSON string the
 * Grafana resource takes.
 *
 * THE KEYS HERE ARE THE PROVIDER'S DIALECT, NOT THE API'S. The provider
 * parses this blob by hand, picking out these exact snake_case keys, and
 * re-marshals them onto the wire as the camelCase the API documents
 * (`datasource_uid` leaves as `datasourceUID`). Writing the API's own
 * spelling here is therefore silently wrong: the provider matches nothing,
 * sends an expression with those fields absent, and the rule either records
 * nothing or is rejected. The provider's own published example is the
 * reference — `node_modules/@pulumiverse/grafana/alerting/
 * recordingRuleV0Alpha1.d.ts`.
 *
 * Built here rather than inline in the component so it can be asserted
 * against directly, which is worth doing because almost none of this fails
 * loudly.
 */
export const recordingRuleExpression = (
  rule: RecordingRule,
  environment: string,
) =>
  JSON.stringify({
    model: {
      editorMode: 'code',
      expr: rule.expr.replace(/\$ENV/g, environment),
      // Instant, not range: a range query returns a series of points per
      // evaluation and a recording rule wants one value per label set.
      instant: true,
      range: false,
      intervalMs: 1000,
      maxDataPoints: 43200,
      legendFormat: '__auto',
      refId: 'A',
    },
    datasource_uid: LOKI_DATASOURCE_UID,
    // Duration strings, not integers, and this is what broke the two deploys
    // on 2026-09-28. The provider reads these with a Go `.(string)` type
    // assertion; a number fails it, leaves both ends empty, and makes the
    // provider drop `relativeTimeRange` from the request altogether. Grafana
    // then rejects the rule with `query expressions must have a relative time
    // range` — reported as a bare HTTP 403, which reads like a missing
    // permission and is why this was first chased as one.
    relative_time_range: {
      from: `${rule.fromSeconds}s`,
      to: `${rule.toSeconds}s`,
    },
    query_type: 'instant',
    // Marks which expression is the rule's output. Without it the rule saves
    // cleanly and records nothing at all.
    source: true,
  })

/**
 * Every alert slug this repo provisions, from both sources.
 *
 * ONE COPY, for the same reason `EXPECTED_PROD_RECEIVERS` is one copy. The
 * routing guard is only as good as the list of alerts it walks: enumerate the
 * slugs separately in the deploy check and in the test suite, and adding a
 * third source of alerts to one of them leaves the other silently walking a
 * stale set — the tests pass while the deploy checks the wrong thing, or the
 * deploy is right and no PR can fail on it.
 *
 * Its own module rather than a member of `alerts.ts`, because
 * `route-alerts.ts` imports from there and importing it back would be a
 * cycle; and rather than a member of `alert-routing.ts`, because that file is a
 * pure simulator that deliberately knows nothing about this repo's alerts.
 */
export const provisionedAlertSlugs = (): string[] => [
  ...GLOBAL_ALERTS.map((alert) => alert.slug),
  ...routeErrorAlerts().map((alert) => alert.slug),
]
