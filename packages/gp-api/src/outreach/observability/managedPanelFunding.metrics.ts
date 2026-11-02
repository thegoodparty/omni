import { Logger } from '@nestjs/common'
import { metrics } from '@opentelemetry/api'

// The two managed panel free-send safety alarms, as one counter the
// `serve-managed-panel-*` Grafana rules read. Same meter pattern as
// person-profiles.metrics.ts: no-op without OTLP export, and a record can
// never break the caller.
const logger = new Logger('ManagedPanelFundingMetrics')

const isOtelEnabled = (): boolean =>
  Boolean(process.env.OTEL_EXPORTER_OTLP_HEADERS)

const environment = (): string =>
  process.env.OTEL_SERVICE_ENVIRONMENT || 'local'

// Prometheus (via Grafana Cloud OTLP) exposes this as
// managed_panel_funding_alarm_count_total{kind=...}.
export const MANAGED_PANEL_FUNDING_ALARM_METRIC =
  'managed_panel_funding_alarm_count_total'

const alarmCounter = metrics
  .getMeter('gp-api')
  .createCounter('managed_panel.funding_alarm.count', {
    description:
      'Serve text sends refused for lack of funding, and reconciliation ' +
      'mismatches, by kind',
  })

/**
 * - send_refused:       a text reached the delivery layer with neither a paid
 *                       checkout nor a valid managed wave, and was not sent
 * - reconcile_mismatch: the daily reconciliation found a send past `pending`
 *                       with neither
 */
export type ManagedPanelFundingAlarm = 'send_refused' | 'reconcile_mismatch'

const ALARMS: ManagedPanelFundingAlarm[] = [
  'send_refused',
  'reconcile_mismatch',
]

// Prometheus `increase()` cannot see the first sample of a new series, so an
// alarm whose series first appears with the event would never fire. Writing a
// zero at boot gives every series a baseline the first real event rises from.
if (isOtelEnabled()) {
  for (const kind of ALARMS) {
    alarmCounter.add(0, { kind, environment: environment() })
  }
}

export const recordManagedPanelFundingAlarm = (
  kind: ManagedPanelFundingAlarm,
  count = 1,
): void => {
  if (!isOtelEnabled()) return
  try {
    alarmCounter.add(count, { kind, environment: environment() })
  } catch (error) {
    logger.error('Failed to record managed panel funding alarm', error)
  }
}
