export type SlackGroup = 'serve-bugs' | 'win-bugs'

/**
 * A cause we already understand for an alert that has already fired.
 *
 * WHY THIS EXISTS: most of the noise in #dev-alerts is not repetition, it is
 * alerts that are individually indistinguishable from a real incident until
 * somebody reads the logs. A district that resolves no match, a pack build that
 * times out on a district too large for the current query plan — the Slack
 * message for those is identical to the message for a genuine regression,
 * because the message is written from the rule and the rule cannot see which
 * one happened.
 *
 * So the filter in front of #dev-alerts cannot work from the notification
 * alone. It needs to know what the known causes ARE, how to check the logs for
 * each, and what to do when one is confirmed. That is this type.
 *
 * IT LIVES BESIDE THE ALERT, not in the filter, for the same reason the alert's
 * `message` does: whoever changes what an alert means is the person who knows
 * what its known causes are, and a registry in another repo drifts silently the
 * moment a query is retuned. grafana.ts serialises this onto the rule as a
 * `known_causes` annotation, which Grafana hands to the webhook verbatim — so
 * the filter reads the version of the registry that provisioned the rule that
 * fired, and no deploy can put the two out of step.
 *
 * ADDING ONE IS A JUDGEMENT WITH TEETH: a cause listed with `action:
 * 'suppress'` stops a human seeing that alert in #dev-alerts. Only list a cause
 * that is genuinely understood AND genuinely not worth waking someone for.
 * "We see this a lot" is not the same as "we know what it is".
 */
export type KnownCause = {
  /**
   * A stable identifier, unique within its alert. This is reported as a metric
   * dimension, so the weekly digest can answer "what did we suppress and how
   * often" — and renaming one restarts its history, which is the point: a
   * renamed cause is usually a different cause.
   */
  id: string
  /**
   * What the cause is, in one sentence a human would recognise. Read by the
   * classifier and quoted into the Slack message when it matches, so it has to
   * be true rather than merely suggestive.
   */
  summary: string
  /**
   * A LogQL query, using `$ENV`, whose result decides whether this is what
   * happened. Narrow it as hard as possible — this runs on every firing of the
   * alert, and Loki bills the bytes it decompresses.
   *
   * Leave unset when the notification's own labels settle it (a per-route alert
   * whose endpoint label already names the cause). The classifier then judges
   * on the payload alone, which is cheaper and is the right call when there is
   * nothing extra to learn.
   */
  evidence?: string
  /**
   * What in that query's output confirms this cause, stated as the condition
   * rather than as a hint. "Every matched line carries `Code: 57014`" is
   * checkable; "look for timeouts" is not, and an unfalsifiable entry is one
   * the classifier will confirm for anything.
   */
  confirmedBy: string
  /**
   * What to do when this cause is confirmed.
   *
   * - `suppress`: understood, and nobody needs to act on this firing. It goes
   *   to the raw channel and is answered in the thread with which cause matched.
   * - `annotate`: still worth a human, but the message should say what this
   *   probably is so the reader does not re-derive it. Use this for a cause
   *   that is understood but not benign — a known regression that is being
   *   worked, a dependency whose outage we can name but must still respond to.
   *
   * There is deliberately no `escalate`: urgency is judged from the alert and
   * the evidence, not declared in advance by whoever added the cause.
   */
  action: 'suppress' | 'annotate'
  /**
   * The ticket tracking this, if one exists. A `suppress` entry with no ticket
   * is how a known issue becomes a permanently invisible one, so the weekly
   * digest names those specifically.
   */
  ticket?: string
}

export type Alert = {
  /** A unique slug for the alert. Used internally for resource naming. */
  slug: string
  /** The human-readable name shown in Grafana and Slack notifications. */
  name: string
  /**
   * The type of datasource the query targets.
   *
   * - `log`: A LogQL metric query against Loki.
   * - `metric`: A PromQL query against Prometheus.
   *
   * All use `$ENV` as a placeholder for the environment name (e.g. "prod").
   */
  type: 'log' | 'metric'
  /**
   * The query expression. Use `$ENV` for the environment name.
   *
   * Log (LogQL) examples:
   *   'count_over_time({service_name="gp-api", deployment_environment_name="$ENV"} |= "Request completed" | json | response_statusCode >= 500 [5m])'
   *   'absent_over_time({service_name="gp-api", deployment_environment_name="$ENV"} [5m])'
   *
   * Metric (PromQL) examples:
   *   'avg(process_cpu_utilization{service_name="gp-api", deployment_environment_name="$ENV"}) * 100'
   *
   * See: https://grafana.com/docs/loki/latest/query/metric_queries/
   * See: https://prometheus.io/docs/prometheus/latest/querying/basics/
   */
  expr: string
  /**
   * How LONG the query results must continuously exceed the threshold before the alert
   * fires. This acts as a grace period to avoid alerting on brief spikes.
   * Format: "<number>m" (e.g. "5m" = 5 minutes).
   */
  for: `${number}m`
  /**
   * The value that `expr` must exceed before the alert starts pending.
   * The unit depends on what your expr returns (e.g. percentage, milliseconds, count).
   */
  threshold: number
  /** A message to include in the Slack notification. */
  message: string

  /**
   * A Grafana annotation template appended to the notification summary, for a
   * rule whose query returns one series per dimension rather than a single
   * value. Grafana renders annotations once per alert instance, so this is
   * what puts the dimension that fired into the title — e.g.
   * '`{{ $labels.request_endpoint }}`' on the generated controller alerts,
   * which return one series per route.
   *
   * Leave unset on a rule that returns one series. `$labels` on such a rule
   * carries only the static labels grafana.ts attaches, so a template here
   * would render either an empty string or something the reader already knows
   * from the rule name.
   */
  summaryDetail?: string

  /**
   * The Slack group, or groups, to notify when the alert is triggered.
   *
   * A list because plenty of routes are not one team's: shared platform
   * surfaces — auth, users, payments, elections — are used by both products,
   * and picking one owner for them means the other finds out second-hand.
   * Order is preserved, so the mentions read in the order they are declared.
   */
  notify?: SlackGroup | SlackGroup[]

  /**
   * How far back (in seconds) the alerting engine fetches data from the
   * datasource on each evaluation. Defaults to 600 (10 minutes). The
   * effective lookback of a range vector is capped by this window — a `[1h]`
   * vector with a 600s fetch only ever sees 10 minutes of data — so set it
   * >= the largest range vector in `expr` when the full window must be
   * visible. Alerts that predate this field keep the 600s cap on purpose:
   * their firing behavior was tuned under it, and widening the fetch would
   * change sensitivity and re-fire duration. Retune those deliberately, not
   * in passing.
   */
  timeRangeSeconds?: number

  /**
   * How often the alerting engine evaluates this rule, in seconds. Defaults to
   * 60.
   *
   * This is a cost lever as much as a latency one. Loki bills the bytes each
   * evaluation decompresses, and `timeRangeSeconds` decides that, so a rule's
   * daily read volume is its window divided by its interval: a 6h window on
   * the 60s default re-reads the same six hours 1,440 times a day. A rule
   * whose window is measured in hours does not need minute-resolution
   * evaluation, and paying for it is how a handful of rules can dominate the
   * Loki bill — see docs/observability.md § Query cost.
   *
   * Grafana evaluates a rule group as a unit, so grafana.ts buckets the global
   * alerts into one group per distinct interval. Raising this also raises the
   * worst-case firing latency: `for` is measured in whole evaluations, so a
   * `for` of one interval can take up to two to fire.
   */
  evaluationIntervalSeconds?: number

  /**
   * Causes for this alert that are already understood, for the filter in front
   * of #dev-alerts. See {@link KnownCause} — in particular, that a `suppress`
   * entry stops a human seeing the alert, so an entry here is a decision about
   * what nobody needs to be told.
   *
   * Unset means "nothing is known in advance", which is the honest default and
   * makes the filter fall through to notifying. Most of these were prose in the
   * alert's own `message` first; moving one here does not remove it from the
   * message, because the message is what a human reads once the filter has
   * decided to show them the alert.
   */
  knownCauses?: KnownCause[]

  /** Whether the alert is disabled. */
  disabled?: boolean
}
