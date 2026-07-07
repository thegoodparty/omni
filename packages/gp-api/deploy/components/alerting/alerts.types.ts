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

  /** Whether the alert is disabled. */
  disabled?: boolean
}
