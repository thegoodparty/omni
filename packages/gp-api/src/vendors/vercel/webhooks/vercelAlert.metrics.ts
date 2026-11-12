import { Logger } from '@nestjs/common'
import { metrics } from '@opentelemetry/api'

// Signed Vercel alerts, as one counter the `vercel-alert` Grafana rule reads.
// Same meter pattern as managedPanelFunding.metrics.ts: no-op without OTLP
// export, and a record can never break the caller.
const logger = new Logger('VercelAlertMetrics')

const isOtelEnabled = (): boolean =>
  Boolean(process.env.OTEL_EXPORTER_OTLP_HEADERS)

const environment = (): string =>
  process.env.OTEL_SERVICE_ENVIRONMENT || 'local'

// Prometheus (via Grafana Cloud OTLP) exposes this as
// vercel_alert_count_total{vercel_event=..., threshold_percent=...}.
export const VERCEL_ALERT_METRIC = 'vercel_alert_count_total'

const alertCounter = metrics
  .getMeter('gp-api')
  .createCounter('vercel_alert.count', {
    description:
      'Signed Vercel webhook alerts (spend, anomaly, attack), by event type ' +
      'and budget threshold',
  })

/**
 * `unrecognized` is a correctly signed delivery whose body failed the schema:
 * Vercel sent something we could not read, which could be a spend alert.
 */
export type VercelAlertEvent =
  | 'budget.reached'
  | 'alerts.triggered'
  | 'firewall.attack'
  | 'unrecognized'

// Vercel sends budget.reached at 50, 75 and 100%, then at every further 100%
// up to 1,000% (https://vercel.com/docs/spend-management#spend-amount).
const BUDGET_THRESHOLDS = [
  '50',
  '75',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
  '1000',
]

// Prometheus `increase()` cannot see the first sample of a new series, so an
// alert whose series first appears with the event would never fire. Every
// label set this counter can write is seeded with a zero at boot, which is
// also why the project is in the log line and not a label: it cannot be
// enumerated here.
if (isOtelEnabled()) {
  for (const threshold of [...BUDGET_THRESHOLDS, 'other']) {
    alertCounter.add(0, {
      vercel_event: 'budget.reached',
      threshold_percent: threshold,
      environment: environment(),
    })
  }
  for (const vercelEvent of [
    'alerts.triggered',
    'firewall.attack',
    'unrecognized',
  ]) {
    alertCounter.add(0, {
      vercel_event: vercelEvent,
      threshold_percent: 'none',
      environment: environment(),
    })
  }
}

/** `thresholdPercent` is set for `budget.reached` only. */
export const recordVercelAlert = (
  vercelEvent: VercelAlertEvent,
  thresholdPercent?: number,
): void => {
  if (!isOtelEnabled()) return
  const threshold =
    thresholdPercent === undefined ? 'none' : String(thresholdPercent)
  try {
    alertCounter.add(1, {
      vercel_event: vercelEvent,
      threshold_percent:
        threshold === 'none' || BUDGET_THRESHOLDS.includes(threshold)
          ? threshold
          : 'other',
      environment: environment(),
    })
  } catch (error) {
    logger.error('Failed to record Vercel alert metric', error)
  }
}
