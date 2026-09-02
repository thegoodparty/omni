export type SlackGroup = 'serve-bugs' | 'win-bugs'

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

  /** The Slack group to notify when the alert is triggered. */
  notify?: SlackGroup

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

  /** Whether the alert is disabled. */
  disabled?: boolean
}
